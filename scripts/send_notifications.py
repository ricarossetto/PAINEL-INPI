#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any


PENDING_PATH = Path("public/data/pending-notifications.json")
NOTIFIED_PATH = Path("public/data/notified-matches.json")
CONFIG_PATH = Path("public/data/config.json")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError:
        return fallback


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def default_recipient() -> str:
    config = read_json(CONFIG_PATH, {})
    return (config.get("notification") or {}).get("email", "")


def notification_monitor_ids() -> set[str]:
    config = read_json(CONFIG_PATH, {})
    notification = config.get("notification") or {}
    raw_ids = notification.get("monitorIds", [])
    if isinstance(raw_ids, str):
        raw_ids = [raw_ids]
    return {str(item).strip() for item in raw_ids if str(item).strip()}


def matches_notification_filter(match: dict[str, Any], monitor_ids: set[str]) -> bool:
    if not monitor_ids:
        return True
    return any(str(monitor.get("id", "")).strip() in monitor_ids for monitor in match.get("monitores", []) or [])


def filter_notification_matches(matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    monitor_ids = notification_monitor_ids()
    return [match for match in matches if matches_notification_filter(match, monitor_ids)]


def summarize_match(match: dict[str, Any]) -> dict[str, str]:
    dispatch = (match.get("despachos") or [{}])[0]
    requerentes = "; ".join(item.get("nome", "") for item in match.get("requerentes", []))
    procuradores = "; ".join(match.get("procuradores", []))
    monitors = ", ".join(item.get("label", "") for item in match.get("monitores", []))
    return {
        "id": match.get("id", ""),
        "revista": str(match.get("revista", {}).get("numero", "")),
        "data": str(match.get("revista", {}).get("data", "")),
        "processo": str(match.get("processo", "")),
        "marca": str(match.get("marca", {}).get("nome", "")),
        "despacho": " - ".join(part for part in [dispatch.get("codigo", ""), dispatch.get("nome", "")] if part),
        "requerentes": requerentes,
        "procuradores": procuradores,
        "monitors": monitors,
        "pdf": str(match.get("links", {}).get("pdf", "")),
        "xml": str(match.get("links", {}).get("xml", "")),
    }


def build_plain(matches: list[dict[str, Any]]) -> str:
    lines = [
        f"Foram encontradas {len(matches)} ocorrencia(s) nova(s) na Revista da Propriedade Industrial.",
        "",
    ]
    for match in matches:
        item = summarize_match(match)
        lines.extend(
            [
                f"RPI {item['revista']} ({item['data']}) - Processo {item['processo']}",
                f"Marca: {item['marca'] or '-'}",
                f"Monitor: {item['monitors'] or '-'}",
                f"Despacho: {item['despacho'] or '-'}",
                f"Procurador: {item['procuradores'] or '-'}",
                f"Requerente: {item['requerentes'] or '-'}",
                f"PDF: {item['pdf'] or '-'}",
                f"XML: {item['xml'] or '-'}",
                "",
            ]
        )
    return "\n".join(lines)


def build_html(matches: list[dict[str, Any]]) -> str:
    rows = []
    for match in matches:
        item = summarize_match(match)
        pdf = f"<a href=\"{html.escape(item['pdf'])}\">PDF</a>" if item["pdf"] else "-"
        xml = f"<a href=\"{html.escape(item['xml'])}\">XML</a>" if item["xml"] else "-"
        rows.append(
            "<tr>"
            f"<td>RPI {html.escape(item['revista'])}<br><small>{html.escape(item['data'])}</small></td>"
            f"<td><strong>{html.escape(item['processo'])}</strong><br>{html.escape(item['marca'] or '-')}</td>"
            f"<td>{html.escape(item['monitors'] or '-')}</td>"
            f"<td>{html.escape(item['despacho'] or '-')}</td>"
            f"<td>{html.escape(item['procuradores'] or '-')}<br><small>{html.escape(item['requerentes'] or '-')}</small></td>"
            f"<td>{pdf} | {xml}</td>"
            "</tr>"
        )

    return f"""
<!doctype html>
<html lang="pt-BR">
  <body style="font-family: Arial, sans-serif; color: #17202a;">
    <h2>Novas ocorrências no INPI</h2>
    <p>Foram encontradas {len(matches)} ocorrência(s) nova(s) na Revista da Propriedade Industrial.</p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse: collapse; border-color: #d9dee7; width: 100%;">
      <thead>
        <tr>
          <th align="left">Revista</th>
          <th align="left">Processo / marca</th>
          <th align="left">Monitor</th>
          <th align="left">Despacho</th>
          <th align="left">Partes</th>
          <th align="left">Links</th>
        </tr>
      </thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
  </body>
</html>
"""


def smtp_ready() -> tuple[bool, list[str]]:
    required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]
    missing = [name for name in required if not env(name)]
    if not (env("NOTIFY_TO") or default_recipient()):
        missing.append("NOTIFY_TO")
    return not missing, missing


def send_email(matches: list[dict[str, Any]]) -> None:
    host = env("SMTP_HOST")
    port = int(env("SMTP_PORT", "587"))
    username = env("SMTP_USER")
    password = env("SMTP_PASSWORD")
    sender = env("SMTP_FROM", username)
    recipient = env("NOTIFY_TO", default_recipient())

    message = EmailMessage()
    message["Subject"] = f"[INPI] {len(matches)} nova(s) ocorrencia(s) na RPI"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(build_plain(matches))
    message.add_alternative(build_html(matches), subtype="html")

    if port == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=60) as server:
            server.login(username, password)
            server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=60) as server:
            if env("SMTP_TLS", "true").lower() != "false":
                server.starttls(context=ssl.create_default_context())
            server.login(username, password)
            server.send_message(message)


def mark_notified(matches: list[dict[str, Any]]) -> None:
    notified = read_json(NOTIFIED_PATH, {"ids": [], "items": {}})
    ids = list(dict.fromkeys([*notified.get("ids", []), *[match["id"] for match in matches if match.get("id")]]))
    items = notified.get("items", {})
    sent_at = now_iso()
    for match in matches:
        if not match.get("id"):
            continue
        items[match["id"]] = {
            "notifiedAt": sent_at,
            **summarize_match(match),
        }
    write_json(NOTIFIED_PATH, {"updatedAt": sent_at, "ids": ids, "items": items})
    write_json(PENDING_PATH, {"generatedAt": sent_at, "matches": []})


def main() -> int:
    pending = read_json(PENDING_PATH, {"matches": []})
    pending_matches = pending.get("matches", [])
    if not pending_matches:
        print("Nenhuma notificacao pendente.")
        return 0
    matches = filter_notification_matches(pending_matches)
    if not matches:
        print("Nenhuma notificacao pendente para os monitores configurados.")
        return 0

    ready, missing = smtp_ready()
    if not ready:
        print("Notificacao por e-mail ignorada. Segredos ausentes: " + ", ".join(missing))
        return 0

    send_email(matches)
    mark_notified(matches)
    print(f"E-mail enviado com {len(matches)} ocorrencia(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
