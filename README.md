# Agenda Sant Feliu ICS

Aquest repositori genera automàticament un fitxer `.ics` i un fitxer `.json` amb els esdeveniments confirmats dels pròxims 60 dies a partir de l'API pública de dades obertes.

## Fitxer generat

- `docs/santfeliu.ics`
- `docs/events.json`

## Ús

Després de generar-los, `docs/events.json` alimenta la web estàtica (`docs/index.html` + `docs/app.js`).

## Execució local

```bash
pip install -r requirements.txt
python scripts/generate_calendar.py
```
