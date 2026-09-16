# Sample visual plug-in

This folder contains a manifest and JavaScript file that can be imported from
the local BI host.

1. Start the local services with `.\scripts\start-local.ps1 -Install`.
2. Open `http://localhost:4200/reports/visuals`.
3. In **Import a visual**, choose `manifest.json` for **Manifest (.json)**.
4. Choose `visual.js` for **Code (.js)** and click **Import visual**.
5. Open or edit a report, add **Sample KPI bars** from the Visualizations pane,
   then assign one category and one measure.

The visual supports click selection, Ctrl/Cmd multi-select, and right-click
**See records** through the sandbox bridge. It has no network access and cannot
read the host page.
