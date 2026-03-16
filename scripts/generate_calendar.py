from __future__ import annotations

import html
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from icalendar import Calendar, Event


RESOURCE_ID = "6353e8e8-53ea-47d9-b121-c4bdeac915a5"
BASE_URL = "https://dadesobertes.seu-e.cat/api/3/action/datastore_search_sql"

TIMEZONE = ZoneInfo("Europe/Madrid")
OUTPUT_DIR = Path("docs")
OUTPUT_FILE = OUTPUT_DIR / "santfeliu.ics"

DAYS_AHEAD = 60
PAGE_SIZE = 1000
REQUEST_TIMEOUT = 30


def now_local() -> datetime:
    return datetime.now(TIMEZONE).replace(second=0, microsecond=0)


def get_date_range() -> tuple[datetime, datetime]:
    start = now_local()
    end = start + timedelta(days=DAYS_AHEAD)
    return start, end


def format_api_dt(dt: datetime) -> str:
    return dt.strftime("%Y%m%d%H%M%S")


def parse_api_dt(value: str | None) -> datetime | None:
    if not value:
        return None

    value = str(value).strip()
    if not value:
        return None

    for fmt in ("%Y%m%d%H%M%S", "%Y%m%d"):
        try:
            parsed = datetime.strptime(value, fmt)
            return parsed.replace(tzinfo=TIMEZONE)
        except ValueError:
            continue

    return None


def collapse_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def strip_html(raw: str) -> str:
    text = html.unescape(raw)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()


def clean_text(value: Any) -> str:
    if value is None:
        return ""

    text = str(value).strip()
    if not text:
        return ""

    if "<" in text and ">" in text:
        text = strip_html(text)

    text = html.unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    lines = [collapse_whitespace(line) for line in text.split("\n")]
    lines = [line for line in lines if line]

    return "\n".join(lines).strip()


def build_sql(start_dt: datetime, end_dt: datetime, limit: int, offset: int) -> str:
    start_str = format_api_dt(start_dt)
    end_str = format_api_dt(end_dt)

    return f"""
        SELECT *
        FROM "{RESOURCE_ID}"
        WHERE "ESTAT" = 'Confirmat'
          AND "DATA_HORA_INICI_ACTE" >= '{start_str}'
          AND "DATA_HORA_INICI_ACTE" < '{end_str}'
        ORDER BY "DATA_HORA_INICI_ACTE" ASC
        LIMIT {limit}
        OFFSET {offset}
    """


def fetch_page(sql: str) -> list[dict[str, Any]]:
    response = requests.get(
        BASE_URL,
        params={"sql": sql},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    payload = response.json()

    if not payload.get("success"):
        raise RuntimeError(f"Resposta incorrecta de l'API: {payload}")

    result = payload.get("result", {})
    return result.get("records", [])


def fetch_all_events() -> list[dict[str, Any]]:
    start_dt, end_dt = get_date_range()

    all_records: list[dict[str, Any]] = []
    offset = 0

    while True:
        sql = build_sql(start_dt, end_dt, PAGE_SIZE, offset)
        records = fetch_page(sql)

        if not records:
            break

        all_records.extend(records)

        if len(records) < PAGE_SIZE:
            break

        offset += PAGE_SIZE

    return all_records


def build_location(record: dict[str, Any]) -> str:
    parts = [
        clean_text(record.get("NOM_LLOC")),
        clean_text(record.get("ADREÇA_COMPLETA")),
    ]
    return " - ".join(part for part in parts if part)


def build_description(record: dict[str, Any]) -> str:
    pieces: list[str] = []

    descripcio = clean_text(record.get("DESCRIPCIO"))
    observacions = clean_text(record.get("OBSERVACIONS"))
    tipus = clean_text(record.get("TIPUS"))
    lloc = clean_text(record.get("NOM_LLOC"))
    adreca = clean_text(record.get("ADREÇA_COMPLETA"))
    url = clean_text(record.get("URL"))

    if descripcio:
        pieces.append(descripcio)

    if observacions:
        pieces.append(observacions)

    meta: list[str] = []
    if tipus:
        meta.append(f"Tipus: {tipus}")
    if lloc:
        meta.append(f"Lloc: {lloc}")
    if adreca:
        meta.append(f"Adreça: {adreca}")
    if url:
        meta.append(f"Enllaç: {url}")

    if meta:
        pieces.append("\n".join(meta))

    return "\n\n".join(piece for piece in pieces if piece).strip()


def get_source_id(record: dict[str, Any]) -> str:
    for key in ("ID", "_id"):
        value = clean_text(record.get(key))
        if value:
            return value
    return ""


def make_uid(record: dict[str, Any], start: datetime, title: str) -> str:
    source_id = get_source_id(record)
    if source_id:
        return f"santfeliu-{source_id}@agenda.santfeliu.local"

    safe_title = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower()).strip("-")
    return f"santfeliu-{safe_title}-{format_api_dt(start)}@agenda.santfeliu.local"


def normalize_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen_uids: set[str] = set()

    for record in records:
        title = clean_text(record.get("TITOL")) or "Sense títol"
        start = parse_api_dt(record.get("DATA_HORA_INICI_ACTE"))
        end = parse_api_dt(record.get("DATA_HORA_FINAL_ACTE"))

        if start is None:
            continue

        if end is None or end <= start:
            end = start + timedelta(hours=1)

        uid = make_uid(record, start, title)
        if uid in seen_uids:
            continue
        seen_uids.add(uid)

        normalized.append(
            {
                "uid": uid,
                "title": title,
                "start": start,
                "end": end,
                "description": build_description(record),
                "location": build_location(record),
                "url": clean_text(record.get("URL")),
                "raw": record,
            }
        )

    normalized.sort(key=lambda item: (item["start"], item["title"]))
    return normalized


def create_calendar(events: list[dict[str, Any]]) -> Calendar:
    cal = Calendar()
    cal.add("prodid", "-//Aitor Rivera//Agenda Sant Feliu//CA")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "Agenda Sant Feliu")
    cal.add("x-wr-timezone", "Europe/Madrid")
    cal.add("method", "PUBLISH")

    generated_at = datetime.now(TIMEZONE)

    for item in events:
        event = Event()
        event.add("uid", item["uid"])
        event.add("summary", item["title"])
        event.add("dtstart", item["start"])
        event.add("dtend", item["end"])
        event.add("dtstamp", generated_at)

        if item["description"]:
            event.add("description", item["description"])

        if item["location"]:
            event.add("location", item["location"])

        if item["url"]:
            event.add("url", item["url"])

        cal.add_component(event)

    return cal


def save_calendar(calendar: Calendar, output_file: Path) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_bytes(calendar.to_ical())


def main() -> None:
    raw_records = fetch_all_events()
    events = normalize_records(raw_records)
    calendar = create_calendar(events)
    save_calendar(calendar, OUTPUT_FILE)

    start_dt, end_dt = get_date_range()

    print(f"Rang consultat: {start_dt.isoformat()} -> {end_dt.isoformat()}")
    print(f"Registres recuperats: {len(raw_records)}")
    print(f"Esdeveniments finals: {len(events)}")
    print(f"Fitxer generat: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
