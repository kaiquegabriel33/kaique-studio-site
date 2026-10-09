"""Radar de pautas do Kaique Studio.

Lê Google Trends (Brasil), Google Notícias por tema e o RSS dos veículos,
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
import unicodedata
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


def agrupar(itens: list[dict]) -> list[list[dict]]:
    grupos: list[list[dict]] = []
    for it in itens:
        p = palavras(it["titulo"])
        for g in grupos:
            if p and any(mesma_noticia(p, outro["_p"]) for outro in g[:6]):
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

    with ThreadPoolExecutor(max_workers=8) as ex:
        for lista in ex.map(um, tarefas):
            brutos.extend(lista)

    try:
        trends = ler_trends(cfg["google_trends"])
    except Exception as e:
        trends, falhas = [], falhas + [f"Google Trends: {type(e).__name__}"]

    recentes = [i for i in brutos if i["publicado"] is None or agora - i["publicado"] <= timedelta(hours=30)]
    for i in recentes:
        i["temas"], i["pontos"], _ = classificar(i["titulo"] + " " + i["resumo"], cfg)
        i["video"], i["declaracao"] = sinais(i["titulo"], cfg)
    relevantes = [i for i in recentes if i["temas"]]
    relevantes.sort(key=lambda i: i["publicado"] or agora, reverse=True)

    preferidos = set(cfg.get("veiculos_preferidos", [])) | {f["veiculo"] for f in cfg["fontes_rss"]}
    pautas = []
    for g in agrupar(relevantes):
        veiculos = {i["veiculo"] for i in g}
        lider = max(g, key=lambda i: (i["veiculo"] in preferidos, i["veiculo"] != "Google Notícias", -len(i["titulo"])))
        mais_novo = max((i["publicado"] for i in g if i["publicado"]), default=None)
        horas = (agora - mais_novo).total_seconds() / 3600 if mais_novo else 12
        temas = sorted({t for i in g for t in i["temas"]})
        rot = lambda i: e_rotina(i["titulo"], cfg)
        rotina = rot(lider) or sum(map(rot, g)) >= len(g) / 2
        score = (max(i["pontos"] for i in g) + 3 * min(len(veiculos) - 1, 6) + max(0, 10 - horas / 2.4)
                 - (12 if rotina else 0))
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
    pautas.sort(key=lambda p: p["score"], reverse=True)

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
        "fontes_ok": len(tarefas) + 1 - len(falhas),
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
          f"{len(dados['falas_e_videos'])} falas/vídeos, fontes ok {dados['fontes_ok']}, falhas {len(dados['falhas'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
