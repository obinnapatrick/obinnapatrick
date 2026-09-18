"""Static supplier-profile renderer. Input: a truth-slice JSON. Output:
one self-contained HTML file (no runtime dependencies, no live queries).
Every displayed claim shows its fact state and links to its evidence
record in the on-page evidence panel.
"""
from __future__ import annotations

import html
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from src import util  # noqa: E402

CSS = """
body{font-family:Georgia,serif;margin:0;background:#faf9f6;color:#1a1a1a;line-height:1.5}
main{max-width:1080px;margin:0 auto;padding:24px}
h1{font-size:1.6rem;margin:.2em 0}h2{font-size:1.15rem;border-bottom:2px solid #d8d3c8;padding-bottom:4px;margin-top:2em}
table{border-collapse:collapse;width:100%;font-size:.85rem;background:#fff}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#efece5}
.banner{padding:10px 16px;font-weight:bold;border-radius:4px;margin:12px 0}
.banner.fixture{background:#7a1f1f;color:#fff;font-size:1.05rem}
.banner.state{background:#2f3e4d;color:#fff}
.chip{display:inline-block;font-family:monospace;font-size:.7rem;background:#e8e4da;border:1px solid #c9c2b2;border-radius:3px;padding:0 4px;margin:1px;text-decoration:none;color:#4a4436}
.fact{display:inline-block;font-size:.7rem;font-weight:bold;border-radius:3px;padding:0 6px;color:#fff}
.fact.CONFIRMED{background:#1e6b3a}.fact.PROBABLE{background:#3a6ea5}.fact.POSSIBLE{background:#a5720f}
.fact.UNRESOLVED{background:#777}.fact.CONFLICTING{background:#8a2be2}
.small{font-size:.8rem;color:#555}
code{background:#eee;padding:0 3px;font-size:.85em}
.evrow td{font-family:monospace;font-size:.72rem}
"""


def _h(x) -> str:
    return html.escape(str(x)) if x is not None else "—"


def _fact(state) -> str:
    s = _h(state or "UNRESOLVED")
    return f'<span class="fact {s}">{s}</span>'


def _chips(ids) -> str:
    return " ".join(f'<a class="chip" href="#ev-{_h(i)}">{_h(i)}</a>' for i in (ids or []))


def render(slice_doc: dict, out_path: str, release_state: str = "UNDECIDED") -> str:
    s = slice_doc.get("supplier") or {}
    meta = slice_doc.get("meta") or {}
    fixture = bool(meta.get("fixture_mode"))
    parts = [f"<style>{CSS}</style><main>"]

    if fixture:
        parts.append('<div class="banner fixture">SYNTHETIC TEST FIXTURE — '
                     'NOT REAL DATA. This page exists only to prove the '
                     'rendering pipeline works. No fact on this page is about '
                     'any real organisation.</div>')
    parts.append(f'<div class="banner state">Release state: {_h(release_state)} · '
                 f'Built {_h(meta.get("built_at"))} · Offline rebuild: '
                 f'<code>{_h(meta.get("rebuild_command"))}</code></div>')

    parts.append(f"<h1>{_h(s.get('official_name'))}</h1>")
    src_list = s.get("source_list") or {}
    parts.append(
        f'<p>Official strategic supplier per the captured GOV.UK list '
        f'{_fact(s.get("fact_state"))} {_chips(s.get("evidence"))}<br>'
        f'<span class="small">List source: <a href="{_h(src_list.get("source_url"))}">'
        f'{_h(src_list.get("source_url"))}</a> · raw capture: '
        f'<code>{_h(src_list.get("raw_path"))}</code> · row {_h(s.get("row_ordinal"))}'
        + (f' · Crown Representative: {_h(s.get("crown_representative"))}'
           if s.get("crown_representative") else "")
        + "</span></p>")

    parts.append("<h2>Legal-entity candidates</h2><table><tr><th>Name</th>"
                 "<th>Company number</th><th>Match method</th><th>State</th>"
                 "<th>Reason</th><th>Evidence</th></tr>")
    for e in slice_doc.get("legal_entities", []):
        m = e.get("match") or {}
        parts.append(
            f"<tr><td>{_h(e.get('name'))}</td><td>{_h(e.get('company_number'))}</td>"
            f"<td><code>{_h(m.get('method'))}</code></td><td>{_fact(m.get('fact_state'))}</td>"
            f"<td class='small'>{_h(m.get('reason'))}</td><td>{_chips(e.get('evidence'))}</td></tr>")
    parts.append("</table>")

    ch_records = slice_doc.get("companies_house_records", [])
    parts.append("<h2>Companies House evidence</h2>")
    if ch_records:
        parts.append("<table><tr><th>Number</th><th>Name</th><th>Status</th>"
                     "<th>Created</th><th>Previous names</th><th>PSC (minimised)</th>"
                     "<th>Evidence</th></tr>")
        for r in ch_records:
            prev = "; ".join(_h(p.get("name")) for p in r.get("previous_names") or []) or "—"
            psc = "; ".join(f"{_h(p.get('name'))} [{', '.join(map(_h, p.get('natures_of_control') or []))}]"
                            for p in r.get("psc_summary") or []) or "—"
            parts.append(
                f"<tr><td><a href='{_h(r.get('web_profile_url'))}'>{_h(r.get('company_number'))}</a></td>"
                f"<td>{_h(r.get('company_name'))}</td><td>{_h(r.get('company_status'))}</td>"
                f"<td>{_h(r.get('date_of_creation'))}</td><td>{prev}</td><td class='small'>{psc}</td>"
                f"<td>{_chips(r.get('evidence'))}</td></tr>")
        parts.append("</table>")
    else:
        parts.append('<p class="small">No Companies House capture available for the '
                     'matched entities. Enrichment state: UNRESOLVED (see manual review).</p>')

    parts.append("<h2>Linked public contract notices</h2><table><tr><th>Notice</th>"
                 "<th>Buyer</th><th>Value</th><th>Dates</th><th>CPV</th>"
                 "<th>Link state</th><th>Method</th><th>Evidence</th></tr>")
    for c in slice_doc.get("contracts", []):
        link = c.get("supplier_link") or {}
        v = c.get("value") or {}
        d = c.get("dates") or {}
        val = f"{v.get('amount'):,.0f} {_h(v.get('currency'))}" if v.get("amount") is not None else "—"
        dates = f"award {_h(d.get('award'))}<br>{_h(d.get('start'))} → {_h(d.get('end'))}"
        cpv = ", ".join(_h(x.get("code")) for x in c.get("cpv") or []) or "—"
        parts.append(
            f"<tr><td><a href='{_h(c.get('notice_url'))}'>{_h(c.get('title'))}</a>"
            f"<br><span class='small'>{_h(c.get('record_id'))} · {_h(c.get('source'))} · "
            f"stage {_h(c.get('stage'))}</span></td>"
            f"<td>{_h((c.get('buyer') or {}).get('name'))}</td><td>{val}</td>"
            f"<td class='small'>{dates}</td><td class='small'>{cpv}</td>"
            f"<td>{_fact(link.get('fact_state'))}</td><td><code>{_h(link.get('method'))}</code></td>"
            f"<td>{_chips((c.get('evidence') or [])[:6])}</td></tr>")
    parts.append("</table>")

    parts.append("<h2>Buyer authorities in this slice</h2><ul>")
    for b in slice_doc.get("public_bodies", []):
        parts.append(f"<li>{_h(b.get('name'))} — {len(b.get('contract_record_ids') or [])} "
                     f"notice(s) {_chips(b.get('evidence'))}</li>")
    parts.append("</ul>")

    parts.append("<h2>Ownership / control evidence</h2>")
    edges = slice_doc.get("ownership_edges", [])
    if edges:
        parts.append("<table><tr><th>Controller</th><th>Controlled</th><th>Natures of control</th>"
                     "<th>State</th><th>Date</th><th>Evidence</th></tr>")
        for e in edges:
            parts.append(
                f"<tr><td>{_h(e.get('from_entity'))}</td><td>{_h(e.get('to_entity'))}</td>"
                f"<td class='small'>{', '.join(map(_h, e.get('natures_of_control') or []))}</td>"
                f"<td>{_fact(e.get('fact_state'))}</td><td>{_h(e.get('evidence_date'))}</td>"
                f"<td>{_chips(e.get('evidence'))}</td></tr>")
        parts.append("</table>")
    else:
        parts.append('<p class="small">No ownership/control evidence captured. '
                     'State: UNRESOLVED. The atlas never infers ownership.</p>')

    parts.append("<h2>Dependency indicators (neutral, dataset-relative)</h2>"
                 "<table><tr><th>Indicator</th><th>Value</th><th>Formula</th>"
                 "<th>Confidence</th><th>Limitations</th><th>Evidence</th></tr>")
    for ind in slice_doc.get("indicators", []):
        val = ind.get("value")
        val = json.dumps(val) if isinstance(val, (dict, list)) else _h(val)
        parts.append(
            f"<tr><td>{_h(ind.get('name'))}</td><td>{val} {_h(ind.get('unit') or '')}</td>"
            f"<td class='small'><code>{_h(ind.get('formula'))}</code></td>"
            f"<td>{_fact(ind.get('confidence'))}</td>"
            f"<td class='small'>{_h(ind.get('limitations'))}</td>"
            f"<td>{_chips((ind.get('evidence_ids') or [])[:4])}</td></tr>")
    parts.append("</table>")

    parts.append("<h2>Unresolved items / manual-review queue</h2><table><tr>"
                 "<th>Item</th><th>Issue</th><th>Severity</th><th>Next step</th>"
                 "<th>Publication status</th></tr>")
    for m in slice_doc.get("manual_review_items", []):
        parts.append(
            f"<tr><td><code>{_h(m.get('item_id'))}</code><br><span class='small'>"
            f"{_h(m.get('entity_affected'))}</span></td><td>{_h(m.get('issue_type'))}</td>"
            f"<td>{_h(m.get('severity'))}</td><td class='small'>{_h(m.get('recommended_next_step'))}</td>"
            f"<td class='small'>{_h(m.get('publication_status'))}</td></tr>")
    parts.append("</table>")

    parts.append("<h2>Evidence panel</h2><p class='small'>Every chip above links here. "
                 "Each record resolves to a saved raw file and JSON pointer.</p>"
                 "<table><tr><th>Evidence ID</th><th>Source</th><th>Field</th>"
                 "<th>Value</th><th>Raw file · pointer</th><th>Retrieved</th>"
                 "<th>Provenance</th><th>Class</th></tr>")
    for e in slice_doc.get("evidence_ledger", []):
        val = e.get("extracted_value")
        val = json.dumps(val, ensure_ascii=False) if isinstance(val, (dict, list)) else _h(val)
        parts.append(
            f"<tr class='evrow' id='ev-{_h(e['evidence_id'])}'><td>{_h(e['evidence_id'])}</td>"
            f"<td><a href='{_h(e.get('source_url'))}'>{_h(e.get('source'))}</a></td>"
            f"<td>{_h(e.get('field'))}</td><td>{val}</td>"
            f"<td>{_h(e.get('raw_path'))}<br>{_h(e.get('json_pointer'))}</td>"
            f"<td>{_h(e.get('retrieved_at'))}</td><td>{_h(e.get('provenance_class'))}</td>"
            f"<td>{_h(e.get('evidence_class'))}</td></tr>")
    parts.append("</table>")

    parts.append(
        "<h2>Method, limitations, state</h2><ul>"
        "<li>Methodology: docs/METHODOLOGY.md</li>"
        "<li>Limitations: docs/LIMITATIONS.md (visibility ≠ dependence; partial dataset)</li>"
        "<li>Publication safety: docs/PUBLICATION_SAFETY.md</li>"
        "<li>Manual review queue: data/manual_review/queue.jsonl</li>"
        f"<li>Slice meta: <code>{_h(json.dumps(meta.get('counts')))}</code></li>"
        "</ul>")
    if fixture:
        parts.append('<div class="banner fixture">SYNTHETIC TEST FIXTURE — NOT REAL DATA.</div>')
    parts.append("</main>")

    doc = ("<!doctype html><html><head><meta charset='utf-8'>"
           f"<title>{_h(s.get('official_name'))} — supplier profile"
           + (" [SYNTHETIC FIXTURE]" if fixture else "") + "</title></head><body>"
           + "".join(parts) + "</body></html>")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(doc)
    return out_path
