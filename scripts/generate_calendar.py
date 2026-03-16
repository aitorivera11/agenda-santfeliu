import os
from datetime import datetime, timedelta
from pathlib import Path

import requests
from icalendar import Calendar, Event


RESOURCE_ID = "6353e8e8-53ea-47d9-b121-c4bdeac915a5"
BASE_URL = "https://dadesobertes.seu-e.cat/api/3/action/datastore_search_sql"
OUTPUT_DIR = Path("docs")
OUTPUT_FILE = OUTPUT_DIR / "agenda_santfeliu_proper_mes.ics"


def get_next_month_range() -> tuple[datetime, datetime]:
    now = datetime.now()
    year = now.year
    month = now.month

    if month == 12:
        start = datetime(year + 1, 1, 1, 0, 0, 0)
        end = datetime(year + 1, 2, 1, 0, 0, 0)
    elif month == 11:
        start = datetime(year, 12, 1, 0, 0, 0)
        end = datetime(year + 1, 1, 1, 0, 0, 0)
    else:
        start = datetime(year, month + 1, 1, 0, 0, 0)
        end = datetime(year, month + 2, 1, 0, 0, 0)

    return start, end


def format_api_dt(dt: datetime) -> str:
    return dt.strftime("%Y%m%d%H%M%S")


def parse_api_dt(value: str | None) -> datetime | None:
    if not value:
        return None

    value = value.strip()
    if not value:
        return None

    try:
        return datetime.strptime(value, "%Y%m%d%H%M%S")
    except ValueError:
        return None


def fetch_events() -> list[dict]:
    start_dt, end_dt = get_next_month_range()

    sql = f"""
        SELECT *
        FROM "{RESOURCE_ID}"
        WHERE "ESTAT" = 'Confirmat'
          AND "DATA_HORA_INICI_ACTE" >= '{format_api_dt(start_dt)}'
          AND "DATA_HORA_INICI_ACTE" < '{format_api_dt(end_dt)}'
        ORDER BY "DATA_HORA_INICI_ACTE" ASC
    """

    response = requests.get(
        BASE_URL,
        params={"sql": sql},
        timeout=30,
    )
    response.raise_for_status()

    data = response.json()
    if not data.get("success"):
        raise RuntimeError(f"Resposta incorrecta de l'API: {data}")

    result = data.get("result", {})
    records = result.get("records", [])
    return records


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return str(value).strip()


def build_description(record: dict) -> str:
    parts = [
        clean_text(record.get("DESCRIPCIO")),
        clean_text(record.get("OBSERVACIONS")),
    ]

    nom_lloc = clean_text(record.get("NOM_LLOC"))
    adreca = clean_text(record.get("ADREÇA_COMPLETA"))
    url = clean_text(record.get("URL"))

    if nom_lloc:
        parts.append(f"Lloc: {nom_lloc}")
    if adreca:
        parts.append(f"Adreça: {adreca}")
    if url:
        parts.append(f"URL: {url}")

    return "\n\n".join(part for part in parts if part)


def build_location(record: dict) -> str:
    nom_lloc = clean_text(record.get("NOM_LLOC"))
    adreca = clean_text(record.get("ADREÇA_COMPLETA"))
    return " - ".join(part for part in [nom_lloc, adreca] if part)


def create_calendar(records: list[dict]) -> Calendar:
    cal = Calendar()
    cal.add("prodid", "-//Agenda Sant Feliu//GitHub Actions//")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "Agenda Sant Feliu - Proper mes")
    cal.add("x-wr-timezone", "Europe/Madrid")

    seen_uids = set()

    for record in records:
        title = clean_text(record.get("TITOL")) or "Sense títol"
        start = parse_api_dt(record.get("DATA_HORA_INICI_ACTE"))
        end = parse_api_dt(record.get("DATA_HORA_FINAL_ACTE"))

        if not start:
            continue

        if not end or end <= start:
            end = start + timedelta(hours=1)

        source_id = clean_text(record.get("ID")) or clean_text(record.get("_id"))
        if not source_id:
            source_id = f"{title}-{format_api_dt(start)}"

        uid = f"santfeliu-{source_id}@agenda-local"

        if uid in seen_uids:
            continue
        seen_uids.add(uid)

        event = Event()
        event.add("uid", uid)
        event.add("summary", title)
        event.add("dtstart", start)
        event.add("dtend", end)

        description = build_description(record)
        if description:
            event.add("description", description)

        location = build_location(record)
        if location:
            event.add("location", location)

        url = clean_text(record.get("URL"))
        if url:
            event.add("url", url)

        cal.add_component(event)

    return cal


def save_calendar(calendar: Calendar, output_file: Path) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_bytes(calendar.to_ical())


def main() -> None:
    records = fetch_events()
    calendar = create_calendar(records)
    save_calendar(calendar, OUTPUT_FILE)

    print(f"Fitxer generat: {OUTPUT_FILE}")
    print(f"Esdeveniments recuperats: {len(records)}")


if __name__ == "__main__":
    main()
