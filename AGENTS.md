# AI export controls game model

Python model in `src/ai_controls`, browser port in `web/model.js`, site at `index.html` (GitHub Pages serves `main` from the repository root; keep `.nojekyll`). Parameters live only in `configs/*.yaml`; after editing them run `python -m ai_controls.cli export-web` to regenerate `web/params.js`.

- Any change to the model equations must be made in both `src/ai_controls/` and `web/model.js`; `pytest` includes `tests/test_web_parity.py`, which fails if they diverge. Bump the `?v=` query on the asset links in `index.html` when assets change.
- Keep empirical claims sourced and subjective assumptions labelled (`status` in the YAML). Never present illustrative values as measurements, or attribute numbers to debate participants beyond what they stated.
- Repository: `Forkhead-box-protein-P2/ai-export-controls-model`. Use the repository-local author and committer identity `Forkhead-box-protein-P2 <311572148+Forkhead-box-protein-P2@users.noreply.github.com>` and that account's existing authentication, without changing the default GitHub account or storing credentials in files.
- Preserve public anonymity: no personal names, personal handles, email addresses, local absolute paths or identifying metadata in public files or commits. Audit content and commit metadata before every push.
- Generated output (runs, plots, sweeps) goes to `outputs/`, which locally is a link to storage outside iCloud (`~/LocalProjectData/ExportControls/outputs`); the Python environment is `~/LocalProjectData/ExportControls/venv`. Do not write bulk output into the project folder.
- Read `~/AgentNotes/claude-codex.md` at session start; append a dated entry when changing folder locations, storage layout or background jobs.
