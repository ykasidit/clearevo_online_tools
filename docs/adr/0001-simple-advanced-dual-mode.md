# 0001 — Simple/Advanced dual-mode UI for the MRI/CT CD Viewer

Date: 2026-07-25
Status: accepted

## Context

The viewer serves two audiences with conflicting vocabulary needs. The patient
opening their own scan CD needs plain words ("Brightness") and a short toolbar;
the doctor/radiologist — who is the *recommender* that sends patients to the tool,
and sometimes a user themselves — expects PACS-standard terms (W/L, Cine, Tags)
and reads plain-word relabeling as a toy. Word-of-mouth needs both: the patient
must succeed unaided, the professional must find it credible enough to recommend.

Alternatives considered:

- **Patient-only plain words** — maximum simplicity, but costs professional
  credibility and the recommendation channel with it.
- **Radiologist-first feature race** (MPR, ROI, sync) — contradicts the
  "not a medical device" positioning and is the heaviest path at hobby scale.
- **Two separate layouts** — best-case UX for each audience but is genuinely two
  UIs to build, test (both form factors), and localize forever.

## Decision

One UI with a persisted mode toggle:

- **Simple mode** (default for first-time visitors, stored per browser like
  `ce_lang`): plain-language labels and only the ten essential controls visible.
- **Advanced mode**: the full toolbar with PACS-standard vocabulary.

The mode changes **only labels and control visibility — never behavior, gestures,
or code paths**. Every tool that exists in Simple behaves identically in Advanced.

## Consequences

- Both audiences get a first screen in their own language for ~1 day of work and
  one codebase; no interaction is tested twice.
- The invariant "labels and visibility only" is the load-bearing constraint: the
  moment a mode changes behavior, the two modes become two products and the cost
  rationale collapses. Future features must pick a mode by *visibility*, not fork
  logic.
- `ce_mode` in localStorage and the how-to's documentation of both vocabularies
  make this hard to walk back quietly; renaming or removing a mode is a breaking
  docs + muscle-memory change.
- i18n cost grows: each relabeled control needs Simple and Advanced strings in
  every language (currently EN/TH).
