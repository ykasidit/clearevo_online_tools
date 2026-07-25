# CONTEXT — ClearEvo online tools (ubiquitous language)

Glossary of project-specific terms. Standard DICOM vocabulary (series, slice,
window/level, cine, DICOMDIR) keeps its industry meaning and is not redefined here.

## MRI/CT CD Viewer (public/dicom)

- **Simple mode** — the default UI mode a first-time visitor gets: plain-language
  button labels and pro-only controls hidden. Aimed at a patient opening their own
  scan CD. Persisted per browser (like `ce_lang`).
- **Advanced mode** — the full toolbar with PACS-standard vocabulary (W/L, Cine,
  Tags). Aimed at doctors/radiologists. Identical tools and gestures underneath;
  the mode changes only labels and control visibility, never behavior.
- **Recommender vs user** — the doctor/radiologist is the *recommender* ("open
  your CD at clearevo.com/dicom"); the patient is the primary *user*. UI flows are
  optimized for the patient; vocabulary credibility (Advanced mode) exists so
  professionals keep recommending.
- **Demo scan** — the author's own anonymized CT/MRI scans (GPL v2), downloaded
  whole from the site (not streamed) and opened locally like a real CD. Two kinds:
  the **small demo** (~50 MB, one representative series; the primary first-taste
  button) and the **full CD demos** (complete 1.2 GB / 870 MB CD zips; secondary links).
- **Clinic sheet** — the one-page printable hand-out (EN/TH, QR code to the tool)
  a clinician gives a patient together with their scan CD.
- **Gesture hint** — the few-second animated finger overlay that plays when a tool
  is selected, acting out that tool's drag/tap gesture.
- **Index-first streaming** — reading a CD's DICOMDIR index first, then only the
  slices actually viewed (File.slice locally / HTTP Range remotely). The engine
  supports both; the start page currently exposes local open only.
