# plugin-switch

Zeigt in einem Panel alle Plugins der Session (Tools, Skills/Befehle), schlägt anhand des Prompts passende Plugins vor und blendet andere pro Session aus.

- `/pswitch` – Panel öffnen
- `/pswitch coding|legal|marketing|produkt|research|alle` – Profil aktivieren
- `/pswitch on <plugin>` / `/pswitch off <plugin>` – einzeln umschalten
- `/pswitch vorschlag` – letzten Vorschlag übernehmen

Ausgeblendete Plugins verlieren ihre MCP-Tools, ihre Skills verschwinden aus der Liste und Skill-Aufrufe werden abgelehnt. Nichts wird deinstalliert.

## Installation

In einer Claude-Code-Session eintippen (`<konto>` durch deinen GitHub-Namen ersetzen):

```
/plugin install plugin-switch --marketplace <konto>/plugin-switch
```

Dann `y` zum Hinzufügen des Marketplace und als Bereich „user“ wählen (alle Sessions).

Oder aus einer Shell:

```
claude plugin install plugin-switch --marketplace <konto>/plugin-switch
```
