"""Radar de pautas do Kaique Studio.

Lê Google Trends (Brasil), Google Notícias por tema, o RSS dos veículos e o feed
público dos canais de YouTube (TV, políticos, partidos; views por hora),
filtra pelos temas do Kaique (mercado, economia, política com impacto
econômico, comportamento do investidor), junta a mesma notícia contada por
vários veículos e ordena por relevância. Só usa a biblioteca padrão do Python:
roda igual no computador e no robô do GitHub (Actions), de hora em hora.

    python radar/coletor.py [--saida site/radar/radar.json]

Não usa IA e não escreve conteúdo: só aponta o que está acontecendo. Quem
escolhe o ângulo e escreve é o Claude, na conversa ou na rotina agendada.
"""
from __future__ import annotations

import argparse
import email.utils
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
HT = "{https://trends.google.com/trending/rss}"
ATOM = "{http://www.w3.org/2005/Atom}"
YT = "{http://www.youtube.com/xml/schemas/2015}"
MEDIA = "{http://search.yahoo.com/mrss/}"
BRT = timezone(timedelta(hours=-3))


def normalizar(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", t)


def palavras(texto: str) -> set[str]:
    return {p for p in re.findall(r"[a-z0-9]{3,}", normalizar(texto))
            if p not in {"que", "com", "para", "por", "dos", "das", "nos", "nas", "uma", "sao", "diz", "apos", "mais"}}


def baixar(url: str, tempo: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"})
    with urllib.request.urlopen(req, timeout=tempo) as r:
        return r.read()


def data_rss(texto: str | None) -> datetime | None:
    if not texto:
        return None
    try:
        d = email.utils.parsedate_to_datetime(texto.strip())
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        pass
    try:
        d = datetime.fromisoformat(texto.strip().replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=BRT)  # sem fuso: veículo brasileiro
    except Exception:
        return None


def limpar_titulo(titulo: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", titulo or "")).strip()


def _itens_tolerante(bruto: bytes):
    """XML quebrado (acontece com o g1): extrai os <item> por expressão regular."""
    texto = bruto.decode("utf-8", errors="replace")
    for bloco in re.findall(r"<item[\s>].*?</item>", texto, re.S):
        bloco = re.sub(r"<!\[CDATA\[(.*?)\]\]>", lambda m: html.escape(m.group(1), quote=False), bloco, flags=re.S)
        try:
            yield ET.fromstring(re.sub(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)", "&amp;", bloco))
        except ET.ParseError:
            continue


def limpar_link(link: str) -> str:
    """Tira redirecionadores de RSS: redir.folha.com.br/redir/online/mercado/rss091/*https://... -> https://..."""
    if "redir" in link and "*http" in link:
        return link.split("*", 1)[1]
    return link


def e_rotina(titulo: str, cfg: dict) -> bool:
    """Cotação do dia ("Ibovespa tem ligeira alta", "Dólar volta a R$ 5"): frase fixa ou ativo + movimento."""
    t = " " + normalizar(titulo) + " "
    if any(k in t for k in cfg.get("rotina", [])):
        return True
    m = cfg.get("rotina_mercado") or {}
    inicio = " " + " ".join(t.split()[:3]) + " "
    return any(s in inicio for s in m.get("ativos", [])) and any(v in t for v in m.get("movimentos", []))


def ler_rss(veiculo: str, url: str) -> list[dict]:
    itens = []
    bruto = baixar(url)
    try:
        fonte_itens = list(ET.fromstring(bruto).iter("item"))
    except ET.ParseError:
        fonte_itens = list(_itens_tolerante(bruto))
    for it in fonte_itens:
        titulo = limpar_titulo(it.findtext("title"))
        link = limpar_link((it.findtext("link") or "").strip())
        fonte = it.find("source")
        nome = veiculo
        if fonte is not None and fonte.text:          # Google Notícias informa o veículo real
            nome = fonte.text.strip()
            titulo = re.sub(r"\s+-\s+" + re.escape(nome) + r"$", "", titulo)
        if titulo and link:
            itens.append({"titulo": titulo, "url": link, "veiculo": nome, "publicado": data_rss(it.findtext("pubDate")),
                          "resumo": limpar_titulo(it.findtext("description") or "")[:280], "origem": "rss"})
    return itens


def ler_trends(url: str) -> list[dict]:
    raiz = ET.fromstring(baixar(url))
    saida = []
    for it in raiz.iter("item"):
        termo = (it.findtext("title") or "").strip()
        trafego = (it.findtext(f"{HT}approx_traffic") or "").strip()
        noticias = [{"titulo": limpar_titulo(n.findtext(f"{HT}news_item_title")),
                     "url": (n.findtext(f"{HT}news_item_url") or "").strip(),
                     "veiculo": (n.findtext(f"{HT}news_item_source") or "").strip()}
                    for n in it.findall(f"{HT}news_item")]
        saida.append({"termo": termo, "trafego": trafego, "publicado": data_rss(it.findtext("pubDate")), "noticias": noticias})
    return saida


def numero_yt(texto: str) -> int:
    """'20 mil visualizações' → 20000; '9,4 mil' → 9400; '1,2 mi' → 1200000; '812' → 812."""
    m = re.search(r"([\d.,]+)\s*(mil|mi|bi)?", texto or "")
    if not m:
        return 0
    n = m.group(1).replace(".", "").replace(",", ".")
    try:
        return int(float(n) * {"mil": 1e3, "mi": 1e6, "bi": 1e9}.get(m.group(2), 1))
    except ValueError:
        return 0


def ler_pagina_videos(canal: str, channel_id: str, agora: datetime) -> list[dict]:
    """Aba Vídeos do canal (~30 mais novos). Canal de TV sobe 15 vídeos em meia hora e o feed perde o que bombou
    há 1 h (Band, 21/10: os dois do sigilo com 20 mil e 17 mil views já tinham saído do feed)."""
    pagina = baixar(f"https://www.youtube.com/channel/{channel_id}/videos?hl=pt-BR&gl=BR").decode("utf-8", "replace")
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", pagina, re.S)
    if not m:
        return []
    achados: list[dict] = []

    def andar(o):
        if isinstance(o, dict):
            if "lockupViewModel" in o:
                achados.append(o["lockupViewModel"])
                return
            for v in o.values():
                andar(v)
        elif isinstance(o, list):
            for v in o:
                andar(v)

    andar(json.loads(m.group(1)))
    itens = []
    for l in achados:
        try:
            md = l["metadata"]["lockupMetadataViewModel"]
            partes = [p.get("accessibilityLabel") or p["text"]["content"]
                      for p in md["metadata"]["contentMetadataViewModel"]["metadataRows"][0]["metadataParts"]]
        except (KeyError, IndexError, TypeError):
            continue
        vistas = next((p for p in partes if "visualiza" in p), None)
        quando = next((p for p in partes if p.startswith("há ")), None)
        if not vistas or not quando:            # estreia, ao vivo agora
            continue
        q = re.match(r"há (\d+) (minuto|hora|dia|semana)", quando)
        if not q:
            continue
        idade = int(q.group(1)) * {"minuto": 1 / 60, "hora": 1, "dia": 24, "semana": 168}[q.group(2)]
        itens.append({"titulo": html.unescape(md["title"]["content"]).strip(),
                      "url": f"https://www.youtube.com/watch?v={l['contentId']}", "veiculo": canal,
                      "publicado": agora - timedelta(hours=idade), "resumo": "", "origem": "youtube",
                      "views": numero_yt(vistas)})
    return itens


def ler_youtube(canal: str, channel_id: str, agora: datetime | None = None) -> list[dict]:
    """Feed público do canal (os 15 vídeos mais novos), com visualizações; nada de API nem chave. O feed às vezes
    responde 404/500 (tenta de novo); canal que sobe muito vídeo completa pela aba Vídeos."""
    agora = agora or datetime.now(timezone.utc)
    for tentativa in range(3):
        try:
            raiz = ET.fromstring(baixar("https://www.youtube.com/feeds/videos.xml?channel_id=" + channel_id))
            break
        except urllib.error.HTTPError:
            if tentativa == 2:
                return ler_pagina_videos(canal, channel_id, agora)   # feed fora: a aba Vídeos tem views e idade
            time.sleep(1.5 * (tentativa + 1))
    itens = []
    for e in raiz.findall(f"{ATOM}entry"):
        vid = (e.findtext(f"{YT}videoId") or "").strip()
        titulo = html.unescape(e.findtext(f"{ATOM}title") or "").strip()
        try:
            publicado = datetime.fromisoformat((e.findtext(f"{ATOM}published") or "").strip())
        except ValueError:
            publicado = None
        g = e.find(f"{MEDIA}group")
        desc = (g.findtext(f"{MEDIA}description") if g is not None else "") or ""
        est = g.find(f"{MEDIA}community/{MEDIA}statistics") if g is not None else None
        views = int(est.get("views", "0")) if est is not None else 0
        if vid and titulo:
            itens.append({"titulo": titulo, "url": f"https://www.youtube.com/watch?v={vid}", "veiculo": canal,
                          "publicado": publicado, "resumo": desc.strip().split("\n")[0][:300], "origem": "youtube",
                          "views": views})
    datas = [i["publicado"] for i in itens if i["publicado"]]
    if sum(agora - d < timedelta(hours=6) for d in datas) >= 10:   # (uma live antiga fica no topo do feed)
        try:
            vistos = {i["url"] for i in itens}
            itens += [i for i in ler_pagina_videos(canal, channel_id, agora) if i["url"] not in vistos]
        except Exception:  # noqa: BLE001 — a página é complemento; o feed basta
            pass
    return itens


def por_hora(i: dict, agora: datetime) -> float:
    horas = (agora - i["publicado"]).total_seconds() / 3600 if i.get("publicado") else 24
    return i.get("views", 0) / max(horas, 0.5)


def embate(titulo: str, cfg: dict) -> bool:
    """Candidato/autoridade + verbo de briga na manchete ("Lula aceita…", "Flávio impõe…")."""
    t = " " + normalizar(titulo) + " "
    return (any(" " + a + " " in t for a in cfg.get("autoridades", []))
            and any(" " + v in t for v in cfg.get("verbos_embate", [])))


def classificar(texto: str, cfg: dict) -> tuple[list[str], int, bool]:
    t = " " + normalizar(texto) + " "
    if any(b in t for b in cfg["bloqueio"]):
        return [], 0, False
    temas, pontos = [], 0
    for tema, chaves in cfg["temas"].items():
        achou = sum(1 for k in chaves if (" " + k) in t)
        if achou:
            temas.append(tema)
            pontos += min(achou, 3) * (3 if tema in ("mercado", "economia") else 2)
    video = any(s in t for s in cfg["sinais_video"])
    if re.search(r"r\$\s?\d|\d+(,\d+)?\s?%|\bbilh|\bmilh|\brecorde", t):
        pontos += 3                                     # número concreto rende carrossel
    return temas, pontos, video


def mesma_noticia(p: set[str], q: set[str]) -> bool:
    comum = p & q
    return len(comum) >= 3 and len(comum) / min(len(p), len(q)) >= 0.5


def sinais(titulo: str, cfg: dict) -> tuple[bool, bool]:
    """Pela manchete: fala de vídeo de verdade? é uma declaração repercutindo?"""
    t = " " + normalizar(titulo) + " "
    video = any(" " + s in t for s in cfg["sinais_video"])
    declaracao = any(" " + s + " " in t or " " + s + ":" in t for s in cfg.get("sinais_declaracao", []))
    return video, declaracao


def busca_video(titulo: str) -> str:
    """Link de BUSCA no YouTube (não baixa nada): quem falou + assunto."""
    termos = [w for w in re.findall(r"[\wÀ-ÿ$%,.]+", titulo) if len(w) > 2][:9]
    return "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": " ".join(termos)})


def mesmo_assunto(a: str, b: str, cfg: dict) -> bool:
    """Assunto quente contado pelos dois lados ("Lula aceita condições…" x "Flávio impõe condições…" do sigilo):
    as duas manchetes falam do mesmo assunto da lista e citam a mesma autoridade."""
    ta, tb = " " + normalizar(a) + " ", " " + normalizar(b) + " "
    return (any(k in ta and k in tb for k in cfg.get("assuntos_agrupar", []))
            and any(" " + n + " " in ta and " " + n + " " in tb for n in cfg.get("autoridades", [])))


def agrupar(itens: list[dict], cfg: dict | None = None) -> list[list[dict]]:
    grupos: list[list[dict]] = []
    cfg = cfg or {}
    for it in itens:
        p = palavras(it["titulo"])
        for g in grupos:
            if p and any(mesma_noticia(p, outro["_p"]) or mesmo_assunto(it["titulo"], outro["titulo"], cfg)
                         for outro in g[:6]):
                it["_p"] = p
                g.append(it)
                break
        else:
            it["_p"] = p
            grupos.append([it])
    return grupos


def coletar(cfg: dict) -> dict:
    agora = datetime.now(timezone.utc)
    tarefas = [(f["veiculo"], f["url"]) for f in cfg["fontes_rss"]]
    for q in cfg["buscas_google_noticias"]:
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
            {"q": f"{q} when:1d", "hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-419"})
        tarefas.append(("Google Notícias", url))

    brutos, falhas = [], []

    def um(t):
        try:
            return ler_rss(*t)
        except Exception as e:  # uma fonte fora do ar não derruba o radar
            falhas.append(f"{t[0]}: {type(e).__name__}")
            return []

    canais = cfg.get("youtube_canais", [])

    def um_yt(c):
        try:
            return ler_youtube(c["nome"], c["channel_id"], agora)
        except Exception as e:
            falhas.append(f"YouTube {c['nome']}: {type(e).__name__}")
            return []

    with ThreadPoolExecutor(max_workers=8) as ex:
        for lista in ex.map(um, tarefas):
            brutos.extend(lista)
    with ThreadPoolExecutor(max_workers=3) as ex:       # o feed do YouTube devolve 404/500 se apertar demais
        videos_canal = list(ex.map(um_yt, canais))

    # YouTube: views por hora e quanto o vídeo está acima da mediana do próprio canal
    youtube = []
    for lista in videos_canal:
        if not lista:
            continue
        ritmos = sorted(por_hora(v, agora) for v in lista)
        mediana = ritmos[len(ritmos) // 2] or 1
        for v in lista:
            v["por_hora"] = round(por_hora(v, agora))
            v["acima_mediana"] = round(v["por_hora"] / mediana, 1)
            if v["publicado"] and agora - v["publicado"] <= timedelta(hours=24):
                v["temas"], v["pontos"], _ = classificar(v["titulo"] + " " + v["resumo"], cfg)
                if v["temas"]:
                    youtube.append(v)
    youtube.sort(key=lambda v: v["por_hora"], reverse=True)
    por_canal: dict[str, int] = {}
    vitrine = []                                        # top 15, no máximo 4 por canal (o UOL sobe dezenas)
    for v in youtube:
        por_canal[v["veiculo"]] = por_canal.get(v["veiculo"], 0) + 1
        if por_canal[v["veiculo"]] <= 4 and len(vitrine) < 15:
            vitrine.append(v)

    try:
        trends = ler_trends(cfg["google_trends"])
    except Exception as e:
        trends, falhas = [], falhas + [f"Google Trends: {type(e).__name__}"]

    recentes = [i for i in brutos if i["publicado"] is None or agora - i["publicado"] <= timedelta(hours=30)]
    for i in recentes:
        i["temas"], i["pontos"], _ = classificar(i["titulo"] + " " + i["resumo"], cfg)
        i["video"], i["declaracao"] = sinais(i["titulo"], cfg)
    for v in youtube:                                   # vídeo de TV/político entra nas pautas como vídeo
        v["video"], v["declaracao"] = True, sinais(v["titulo"], cfg)[1]
    relevantes = [i for i in recentes if i["temas"]] + youtube
    relevantes.sort(key=lambda i: i["publicado"] or agora, reverse=True)

    preferidos = set(cfg.get("veiculos_preferidos", [])) | {f["veiculo"] for f in cfg["fontes_rss"]}
    pautas, faro = [], []
    fcfg = cfg.get("faro", {})
    max_v = int(fcfg.get("max_veiculos", 3))
    for g in agrupar(relevantes, cfg):
        veiculos = {i["veiculo"] for i in g}
        lider = max(g, key=lambda i: (i["veiculo"] in preferidos, i["veiculo"] != "Google Notícias", -len(i["titulo"])))
        mais_novo = max((i["publicado"] for i in g if i["publicado"]), default=None)
        horas = (agora - mais_novo).total_seconds() / 3600 if mais_novo else 12
        temas = sorted({t for i in g for t in i["temas"]})
        rot = lambda i: e_rotina(i["titulo"], cfg)
        rotina = rot(lider) or sum(map(rot, g)) >= len(g) / 2
        score = (max(i["pontos"] for i in g) + 3 * min(len(veiculos) - 1, 6) + max(0, 10 - horas / 2.4)
                 - (12 if rotina else 0))
        # velocidade: briga de candidato/autoridade nas últimas 2 h, e vídeo de TV andando rápido
        if horas <= 2 and any(embate(i["titulo"], cfg) for i in g):
            score += 8
        vids = [i for i in g if i.get("origem") == "youtube"]
        top = max(vids, key=lambda i: i["por_hora"], default=None)
        if top:
            score += min(12, top["por_hora"] / 2500) + (4 if top["acima_mediana"] >= 3 else 0)
        # link direto do veículo, quando algum item do grupo tiver (Google Notícias só redireciona)
        diretos = [i for i in g if "news.google.com" not in i["url"]]
        if "news.google.com" in lider["url"] and diretos:
            lider = max(diretos, key=lambda i: (i["veiculo"] in preferidos, -len(i["titulo"])))
        pautas.append({
            "id": hashlib.sha1(normalizar(lider["titulo"]).encode()).hexdigest()[:10],
            "titulo": lider["titulo"], "url": lider["url"], "veiculo": lider["veiculo"],
            "publicado": mais_novo.isoformat() if mais_novo else None,
            "temas": temas, "video": any(i["video"] for i in g), "declaracao": lider["declaracao"],
            "busca_video": busca_video(lider["titulo"]), "veiculos": len(veiculos), "rotina": rotina,
            "outras": [{"veiculo": i["veiculo"], "titulo": i["titulo"], "url": i["url"]} for i in g if i is not lider][:4],
            "score": round(score, 1),
        })
        if top:   # o vídeo de verdade, além da busca
            pautas[-1].update({"video": True, "video_url": top["url"], "video_canal": top["veiculo"],
                               "video_por_hora": top["por_hora"], "video_acima_mediana": top["acima_mediana"],
                               "videos": [{"canal": i["veiculo"], "titulo": i["titulo"], "url": i["url"],
                                           "por_hora": i["por_hora"]}
                                          for i in sorted(vids, key=lambda i: -i["por_hora"])[:6]]})
        # FARO (26/10, ele: "velocidade de publicação de algo bem quente, mas que não é óbvio e ninguém viu"): pauta nova
        # (vista pela 1ª vez nas últimas horas), ainda em 1–3 veículos e com menção na última hora
        noticias_g = [i for i in g if i.get("origem") != "youtube"]
        veic_not = {i["veiculo"] for i in noticias_g}
        datas = [i["publicado"] for i in noticias_g if i["publicado"]]
        if (noticias_g and not rotina and 1 <= len(veic_not) <= max_v and datas
                and agora - min(datas) <= timedelta(hours=float(fcfg.get("horas_pauta", 3)))
                and agora - max(datas) <= timedelta(hours=1)):
            faro.append({"tipo": "pauta", "titulo": lider["titulo"], "url": lider["url"], "veiculos": sorted(veic_not),
                         "qtd_veiculos": len(veic_not), "primeira_vez": min(datas).astimezone(BRT).isoformat(timespec="minutes"),
                         "temas": temas, "forca": round(pautas[-1]["score"] + 10 - 2 * len(veic_not), 1),
                         "porque": f"só {len(veic_not)} veículo{'s' if len(veic_not) > 1 else ''} ({', '.join(sorted(veic_not)[:3])}); "
                                   f"apareceu às {min(datas).astimezone(BRT):%Hh%M}"})
    pautas.sort(key=lambda p: p["score"], reverse=True)

    # FARO (b): vídeo de fonte primária (canal do político, partido, ao vivo/corte de TV) andando bem acima do normal do
    # canal, cujo assunto ainda está em poucos veículos (palavras da manchete x manchetes coletadas)
    manchetes = [(i["veiculo"], palavras(i["titulo"])) for i in recentes if i.get("origem") != "youtube"]
    for v in youtube:
        if not v["publicado"] or agora - v["publicado"] > timedelta(hours=float(fcfg.get("horas_video", 8))):
            continue
        if v["acima_mediana"] < float(fcfg.get("acima_mediana_min", 2.5)) or v["por_hora"] < int(fcfg.get("min_por_hora", 3000)):
            continue
        if e_rotina(v["titulo"], cfg):
            continue
        p = palavras(v["titulo"])
        cobrem = sorted({vei for vei, q in manchetes if len(p & q) >= 3 or (p and mesma_noticia(p, q))})
        if len(cobrem) > max_v:
            continue
        faro.append({"tipo": "video", "titulo": v["titulo"], "url": v["url"], "video_url": v["url"], "canal": v["veiculo"],
                     "views_h": v["por_hora"], "acima_mediana": v["acima_mediana"],
                     "publicado": v["publicado"].astimezone(BRT).isoformat(timespec="minutes"),
                     "veiculos": cobrem, "qtd_veiculos": len(cobrem), "temas": v["temas"],
                     "forca": round(min(20, v["por_hora"] / 2000) + 2 * min(v["acima_mediana"], 8) + 2 * (max_v + 1 - len(cobrem)), 1),
                     "porque": (f"vídeo do {v['veiculo']} com {v['por_hora']:,} views/h ({v['acima_mediana']}x o normal do canal); "
                                + (f"só {len(cobrem)} veículo{'s' if len(cobrem) > 1 else ''} deram" if cobrem else "nenhum veículo deu ainda")
                                ).replace(",", ".")})
    faro.sort(key=lambda x: -x["forca"])
    faro = faro[:int(fcfg.get("max_itens", 10))]

    em_alta = []
    for tr in trends:
        texto = tr["termo"] + " " + " ".join(n["titulo"] for n in tr["noticias"])
        temas, pontos, _ = classificar(texto, cfg)
        if not temas:
            continue
        video = any(sinais(n["titulo"], cfg)[0] for n in tr["noticias"])
        em_alta.append({"termo": tr["termo"], "trafego": tr["trafego"], "temas": temas, "video": video,
                        "noticias": tr["noticias"][:3],
                        "publicado": tr["publicado"].isoformat() if tr["publicado"] else None})

    return {
        "atualizado": agora.astimezone(BRT).isoformat(timespec="minutes"),
        "em_alta": em_alta,
        "pautas": pautas[:40],
        "falas_e_videos": sorted([p for p in pautas if (p["video"] or p["declaracao"]) and not p["rotina"]],
                                 key=lambda p: (not p["video"], -p["score"]))[:12],
        "youtube": [{"titulo": v["titulo"], "url": v["url"], "canal": v["veiculo"],
                     "publicado": v["publicado"].isoformat(), "views": v["views"], "por_hora": v["por_hora"],
                     "acima_mediana": v["acima_mediana"], "temas": v["temas"]} for v in vitrine],
        "faro": faro,
        "fontes_ok": len(tarefas) + len(canais) + 1 - len(falhas),
        "falhas": falhas,
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", default=str(AQUI.parent / "site" / "radar" / "radar.json"))
    args = ap.parse_args(argv)
    cfg = json.loads((AQUI / "config.json").read_text(encoding="utf-8"))
    dados = coletar(cfg)
    saida = Path(args.saida)
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(json.dumps(dados, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"radar: {len(dados['pautas'])} pautas, {len(dados['em_alta'])} em alta, "
          f"{len(dados['falas_e_videos'])} falas/vídeos, {len(dados['youtube'])} do YouTube, {len(dados['faro'])} no faro, fontes ok {dados['fontes_ok']}, falhas {len(dados['falhas'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
