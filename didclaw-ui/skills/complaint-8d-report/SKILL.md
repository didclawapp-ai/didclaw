---
name: complaint-8d-report
description: Generates or completes 8D reports (Eight Disciplines) from customer complaint data, with D1–D8 fill-in guidance and a standard template. Supports customer-specific formats (one supplier, multiple customers with different 8D layouts). Use for customer complaints, quality deviations, and defect recurrence prevention.
triggers:
  - 8D report
  - 8D
  - write 8D
  - create 8D report
  - customer complaint report
  - quality deviation report
  - corrective action report
  - CAR
  - eight disciplines
  - root cause analysis
  - containment action
  - customer format
  - 8D template
  - different 8D format
  - Foxconn 8D
  - OEM 8D
  - automotive 8D
  - tier-1 CAR
  - 8D报告
  - 客诉
  - 客户投诉
  - 纠正措施报告
  - 根因分析
  - 围堵措施
  - 永久措施
  - 8D ppt
  - 8D powerpoint
---

# Customer Complaint 8D Report

> **Note**: `{baseDir}` = the root directory of this skill (where SKILL.md resides). Paths like `{baseDir}/formats/` resolve to the skill's `formats/` folder.

Generates or completes an **8D report** from user-provided complaint data (product, symptom, quantity, customer, dates, etc.) and guides step-by-step completion of D1–D8. Supports **chart/diagram analysis** (e.g. fishbone, 5-Why, Pareto), **image/video evidence** for verification, and **document attachments** for specs and revised procedures. Handles **customer-specific formats**: one supplier may need different 8D layouts for different customers; the skill can use a chosen template or match a user-provided format. Output is structured Markdown suitable for pasting into Word, Excel, or internal systems. Supports **PPT (.pptx)** as final deliverable: generate slide deck or slide-by-slide content for copy-paste.

---

## Customer-specific / multi-customer formats

**Scenario**: A supplier serves multiple customers; each customer requires 8D/CAR in a different format (different section titles, table columns, order of D1–D8, or extra blocks such as "Supplier response date" or "Cost of quality").

**How to handle**:

1. **Ask at the start**: "Which customer or report format should we use? If your customer has a specific template (section names, table layout), paste it or attach it and I’ll match it; otherwise I’ll use the standard template."
2. **If the user names a customer**:
   - Check whether a format definition exists under `{baseDir}/formats/` (e.g. `formats/Customer-A.md` or `formats/automotive-oem.md`). If yes, use that file’s section order and headings to build the report.
   - If no stored format exists, use the standard template and say: "Using the standard template. To reuse a custom format next time, you can add a format file under `formats/` — see `formats/README.md`."
3. **If the user provides a template or example** (pasted text, list of section titles, or attached document):
   - Extract section titles and table headers (and order). Map standard D1–D8 content into those sections: same logic (team, problem, containment, root cause, permanent actions, implement, prevent recurrence, close), but use the **customer’s labels and order**. If their format merges or splits disciplines (e.g. "D4–D5: Root cause and corrective actions"), keep one section and include both contents.
   - If their format has extra fields (e.g. "Cost impact", "RMA number"), add those as rows or blocks with placeholders like `[To be filled]`.
4. **Stored format files** (optional): In the skill folder, `formats/` can contain one file per customer or format (e.g. `Customer-A.md`, `Customer-B.md`). Each file lists the report structure: section titles in order and, if needed, table column headers. The agent then fills content according to this structure. See `{baseDir}/formats/README.md` and any example in `formats/` for the expected format.

**Mapping rule**: The **content** of 8D (team, 5W2H, containment, root cause, permanent actions, implementation, recurrence prevention, closure) stays the same; only **section titles, order, and table/field names** change to match the customer template.

---

## Strict / high-requirement customers (Foxconn, OEMs, tier-1, large accounts)

**When to apply**: The user names or implies a **strict customer** — e.g. Foxconn (Hon Hai), automotive OEMs (VW, Toyota, GM, Ford, etc.), tier-1 suppliers, or other large accounts with formal quality systems (IATF 16949, customer-specific CAR/8D forms). For these customers, use **stricter fill-in prompts** and treat more attachments and fields as **mandatory**.

**What to do**:
- In **step 1 (format)**, if the user says "Foxconn", "OEM", "automotive", "tier-1", or "strict customer", acknowledge it and add: "I’ll use stricter evidence and closure requirements for this report."
- In the **Basic information** block, add (or ensure placeholders for) fields many strict customers require: **RMA / complaint number**, **Supplier response due date**, **Cost of quality or cost impact** (if the customer form has it).
- For **each D**, use the **strict** prompts from the table below (evidence and sign-off are expected, not optional).
- **Closure (D8)**: Require explicit **customer approval / sign-off** and **distribution list**; remind that many OEMs and Foxconn expect signed confirmation or formal closure in their portal.

**Typical strict-customer expectations** (prompt for these when applicable):
- D2: Defect photo + limit sample or customer spec ref; exact lot/batch and quantity.
- D3: Containment actions with **due date** and **effectiveness proof** (e.g. 100% inspection record, quarantine tag photo).
- D4: **Formal 5-Why or fishbone** in the report; root cause **verified** (reproduction test or data).
- D5: Permanent actions with **verification evidence** (trial report, measurement data, or customer approval).
- D6: **Revised document with revision and approval** (SOP/spec/FMEA); implementation scope and effectiveness data.
- D7: **Training record** or attendance; lesson learned / FMEA update reference.
- D8: **Customer closure confirmation** (signed or in portal); report distribution and acknowledgment.

---

## Charts, diagrams, and attachments (when to use)

| Where | Charts / diagrams | Images or video | Documents |
|-------|-------------------|-----------------|-----------|
| **D2** | Optional: defect location sketch, timeline | **Recommended**: defect photos, limit sample, customer evidence | Spec sheet, drawing, limit sample doc ref |
| **D3** | Optional: containment flow | Optional: quarantine area, sorted lots | N/A |
| **D4** | **Recommended**: 5-Why tree, fishbone, Pareto, cause–effect matrix | Optional: reproduction test photos/video, failure mode | Process doc / FMEA excerpt (before) |
| **D5** | Optional: before/after data chart, trial summary | **Recommended**: verification photos or short video (trial, measurement) | Trial report, test protocol |
| **D6** | Optional: Cpk/trend chart | Optional: updated work area, gauge | **Recommended**: revised SOP/spec (cover or excerpt), approval |
| **D7** | Optional: process change summary | Optional: training photo | **Recommended**: training record, lesson learned doc ref |
| **D8** | N/A | Optional: team/customer sign-off photo | **Recommended**: customer closure confirmation, distribution list |

- **Charts/diagrams**: When generating the report, prompt the user to add or describe a diagram where the template says "See diagram" or "Attach chart". If the user can provide data (e.g. defect counts by category, 5-Why steps), generate a text or Mermaid-style diagram in Markdown where applicable. **Strict customers**: Many customer portals do not render Mermaid; remind the user to export fishbone/5-Why diagrams as image or PDF for formal submission.
- **Images/video**: Use placeholders like `[Attach: defect photo]` or `[Attach: video – reproduction test]`; remind the user to attach files when exporting to Word/PPT or uploading to the report system.
- **Documents**: Use placeholders like `[Attach: spec rev X]` or `[Attach: SOP XYZ rev 2 excerpt]`; ask for document number and revision when the user mentions a spec or procedure.

---

## Workflow (fixed order)

1. **Determine report format** (do this first when the user has multiple customers):
   - Ask: "Which customer or 8D format should we use? You can name a customer (if we have a format file for them), paste your customer’s section titles or template, or use the standard format." **Output format**: If the user has already stated they want PPT (e.g. "要PPT"、"导出PPT"、"output as PPT"), use PPT — do not ask again, do not default to Markdown. If unspecified, ask: "Do you need the final output as Markdown/Word, or as PPT (.pptx)?" Default when unspecified: Markdown.
   - If the user names a customer: look for `{baseDir}/formats/<name>.md` (normalize to lowercase, hyphens). If found, use that structure; if not, use the standard template and offer to create a format file for next time.
   - If the user pastes or attaches a template: parse section headings and table headers, then generate the report using that structure and the same D1–D8 content mapping.
   - If no preference: use the "Report template" below (standard).
2. **Gather information**: Confirm or collect at least one of the following  
   - Complaint/case number  
   - Product name, model, batch/lot or production date  
   - Customer name, complaint date, receipt date  
   - Defect description (symptom, quantity, where found, specification requirement)  
   - Responsible department/owner (optional)  
3. **Generate report skeleton**: Output the full 8D document per the chosen format (standard "Report template" below, or customer-specific structure from step 1). Use `[To be filled]` or `[Fill from context above]` for missing items.  
4. **Guide by discipline**: If the user provided only partial information, add a one-line prompt at the end of the relevant D section: "Suggested addition: …".  
5. **Charts and attachments**: Where the template calls for a diagram, image, or document, either (a) generate a text/Mermaid diagram from user data when possible, or (b) insert a clear placeholder (e.g. `[Attach: defect photo]`, `[See fishbone diagram]`) and remind the user to add the file when finalizing the report.  
6. **Output format**: Deliver per user preference. **Critical: when user requested PPT, the deliverable MUST be (a) a .pptx file, or (b) slide-by-slide content in the response for copy-paste. Do NOT save/write a .md file as the output. Do NOT say "如需导出为PPT随时说" — the user already asked for PPT.**
   - **Markdown/Word** (when user did not request PPT): Copy-pasteable Markdown, suggest `8D-{case-number}-{date}.md`; remind to attach images/videos/documents when exporting to Word. If saving .md to disk, output a clickable `file:///` link.
   - **PPT (.pptx)** (when user requested PPT): First try to generate a `.pptx` file via Python `python-pptx` (see "PPT slide structure" below) and save as `8D-{case-number}-{date}.pptx`; then output a **clickable `file:///` link**. If Python is unavailable, output a **slide-by-slide** block (Slide 1: …, Slide 2: …, …) that the user can paste into PowerPoint. The delivered file/link must be .pptx or slide content — never .md when PPT was requested.

---

## Edge cases and special situations

| Situation | Handling |
|-----------|----------|
| **D0 or prep section** | If the customer template includes D0 (prepare/emergency response), add it with the customer's section title and fill per their headings; then proceed with D1–D8 as usual. |
| **Repeat complaint / escalation** | If the user mentions "repeat", "recurrence", or "SCAR escalation", prompt for: comparison with previous 8D, whether management review is required, and what failed in the prior corrective action. Strengthen D4/D7 accordingly. |
| **Confidentiality** | Before sharing or pasting into external portals, remind: customer names, line IDs, or contact details may need redaction depending on company policy. |
| **Mermaid diagrams** | See Charts section above—strict customers often need fishbone/5-Why as image or PDF, not raw Mermaid. |
| **User requested PPT** | Output .pptx or slide-by-slide; never .md as the primary deliverable. Do not offer "export to PPT later" — they already asked. |

---

## Generating .pptx / .pdf files (generate_8d.py)

When the user requests PPT or PDF output, use `{baseDir}/generate_8d.py` to produce the files.  
**Do not write an ad-hoc Python script each time** — always use this pre-built script.

### Steps

1. Build a JSON object from the 8D data collected in the conversation (schema below).
2. Write it to a temporary file, e.g. `C:\Users\<user>\Downloads\8D-CC001.json`.
3. Run the script:

```
python "{baseDir}/generate_8d.py" "C:\path\to\8D-CC001.json" --format both --out "C:\Users\<user>\Downloads"
```

   `--format` options: `pptx` (default) · `pdf` · `both`  
   `--out` defaults to the same folder as the input JSON if omitted.

4. The script prints the output paths and `file:///` links. Return those links to the user so they can click to open.

**Dependencies** (install once if missing):
```
pip install python-pptx fpdf2
```

**PDF and Chinese characters**: the PDF generator auto-detects a CJK font on Windows (`msyh.ttf` / `simhei.ttf`), macOS, and Linux (Noto Sans CJK). If no CJK font is found, Chinese characters in the PDF may appear as boxes — the PPTX is always safe.

### JSON schema

```json
{
  "case_no": "CC-001",
  "date": "2026-04-02",
  "product": "Product Name",
  "customer": "Customer Name",
  "batch": "2026-03",
  "complaint_date": "2026-03-28",
  "receipt_date": "2026-03-29",
  "defect_summary": "One-line defect description",
  "owner": "Team Leader Name",

  "rma_no": "",
  "response_due": "",
  "cost_impact": "",

  "d1_team": [
    {"role": "Leader", "name": "", "dept": "", "responsibility": "Overall coordination", "contact": ""},
    {"role": "Member", "name": "", "dept": "", "responsibility": "", "contact": ""}
  ],

  "d2_5w2h": {
    "what": "", "where": "", "when": "", "who": "", "why": "", "how_many": "", "how": ""
  },
  "d2_problem_statement": "",

  "d3_actions": [
    {"no": 1, "action": "", "owner": "", "due_date": "", "verification": ""}
  ],

  "d4_direct_cause": "",
  "d4_root_cause": "",
  "d4_verification": "",
  "d4_5why": ["Why 1", "Why 2", "Why 3", "Why 4", "Root cause"],

  "d5_actions": [
    {"id": "PC1", "action": "", "owner": "", "planned": "", "result": ""}
  ],

  "d6_documents": "",
  "d6_scope": "",
  "d6_effectiveness": "",

  "d7_prevention": [
    {"category": "Process / Standard", "content": "", "owner": ""},
    {"category": "Horizontal deployment", "content": "", "owner": ""},
    {"category": "Training / Sharing", "content": "", "owner": ""}
  ],

  "d8_closure": "",
  "d8_closure_date": "",
  "d8_distribution": ""
}
```

All fields are optional — missing values are replaced with `[To be filled]` in the output.  
Fields `rma_no`, `response_due`, `cost_impact` only appear in the output when non-empty (strict customers).

---

## PPT slide structure (when output is .pptx)

When the user requests PPT output, structure the deck as follows. Each D becomes one or more slides; use the same content mapping as the Report template.

| Slide | Title | Content |
|-------|-------|---------|
| 1 | Customer Complaint 8D Report — [Case No.] | Cover: Case No., Product, Customer, Report date, Owner |
| 2 | Basic information | Table: Complaint/Case No., Product, Batch, Customer, Complaint date, Defect summary, RMA (if strict) |
| 3 | D1 – Team | Team table (Role, Name, Department, Responsibility) |
| 4 | D2 – Problem description | 5W2H bullets, Problem statement; placeholder for defect photo |
| 5 | D3 – Interim containment | Action list table; containment scope summary |
| 6 | D4 – Root cause | Root cause statement, 5-Why/fishbone summary or [See diagram]; verification note |
| 7 | D5 – Permanent corrective actions | Action table; verification result |
| 8 | D6 – Implement and validate | Updated documents, scope, effectiveness |
| 9 | D7 – Prevent recurrence | Process/system changes, horizontal deployment, training |
| 10 | D8 – Close | Closure summary, customer confirmation, distribution |

- **D4/D5**: If 5-Why or fishbone is lengthy, use an extra slide. Add `[Insert: fishbone diagram]` placeholder.
- **Images**: Use placeholders like `[Insert: defect photo]`; remind the user to insert images manually.
- When generating via `python-pptx`, create slides with title + body text; keep tables concise (avoid wide tables that overflow).

---

## Report template (standard structure)

The template below is the **default** layout. When a customer-specific format is selected (step 1), use that format’s section order and headings instead; the content for each D remains the same.

```markdown
# Customer Complaint 8D Report

## Basic information
| Item | Content |
|------|------|
| Complaint/Case No. | |
| Product name/Model | |
| Batch/Lot or production date | |
| Customer name | |
| Complaint date | |
| Receipt date | |
| Defect summary | |
| Report date | |
| Owner/Team leader | |
| *(Strict customers)* RMA / Customer complaint No. | |
| *(Strict customers)* Supplier response due date | |
| *(Strict customers)* Cost of quality / cost impact (if required) | |

---

## D1 Form the team (Team)
**Purpose**: Establish a cross-functional team and define roles and contacts.

| Role | Name | Department | Responsibility |
|------|------|------------|-----------------|
| Leader | | | Overall coordination, customer interface |
| Member | | | |
| Member | | | |

**Output**: Team roster, roles, meeting plan.

---

## D2 Problem description (Problem Description)
**Purpose**: Clearly define the problem using 5W2H to support root cause analysis.

- **What**: What is the defect (symptom, defect type)?
- **Where**: Where was it found (customer line/warehouse/field)? Which process or component?
- **When**: When did it occur or get detected? Production date vs complaint date?
- **Who**: Which customer(s), line(s), or batch(es) are affected?
- **Why**: Why did the customer deem it nonconforming (spec, limit sample)?
- **How many**: Defect quantity, lot size, defect rate?
- **How did we know**: How was it discovered (inspection, complaint, return)?

**Problem statement (one sentence)**: [ Fill in ]

**Attachments (D2)**:
- **Images**: [Attach: defect photo(s)], [Attach: limit sample / customer evidence]. Optional: defect location sketch or timeline diagram.
- **Documents**: [Attach: spec or drawing ref: doc no., rev] — or list spec number and revision here.

---

## D3 Interim containment (Interim Containment)
**Purpose**: Prevent further escape or escalation and protect the customer.

- Stock/in-transit: Quarantine, 100% inspection, sorting, hold shipment?
- Shipped product: Recall, replacement, sorting at customer?
- Production floor: Line/batch stop, investigation, identification?
- Responsible department and due date: |

**Action list**:
| No. | Action | Owner | Due date | Verification |
|-----|--------|-------|----------|---------------|
| 1 | | | | |
| 2 | | | | |

**Attachments (D3)** (optional): [Attach: photo of quarantine area / sorted lots] or [Attach: containment flow diagram].

---

## D4 Root cause (Root Cause)
**Purpose**: Identify the true cause (verifiable and controllable), not just symptoms.

- Use at least one tool: 5-Why, fishbone (Ishikawa), FMEA, cause–effect matrix, Why-Why analysis.
- **Direct cause** (symptom level): |
- **Root cause** (controllable/verifiable end cause): |
- **Verification**: Reproduction test, data comparison, process traceability? |

**Analysis diagram**: [Attach or insert: 5-Why tree / fishbone diagram / Pareto or stratification chart]. If user provides steps or categories, generate a text or Mermaid diagram here.

**Root cause statement**: [ One sentence: "Due to … which resulted in …" ]

**Attachments (D4)**:
- **Charts/diagrams**: [See 5-Why / fishbone / Pareto above or attach file].
- **Images/video** (optional): [Attach: reproduction test photo or short video], [Attach: failure mode evidence].
- **Documents** (optional): [Attach: process doc or FMEA excerpt – before state].

---

## D5 Permanent corrective actions – select and verify (Permanent Corrective Actions)
**Purpose**: Choose permanent actions that address the root cause and verify effectiveness.

- Action(s) (may be multiple): |
- Rationale (why this action eliminates the root cause): |
- Verification: Trial run, pilot batch, data comparison, customer confirmation? |
- Verification result: OK/NG with brief data or conclusion. |

| Action ID | Action | Owner | Planned completion | Verification result |
|-----------|--------|-------|--------------------|----------------------|
| PC1 | | | | |
| PC2 | | | | |

**Attachments (D5)**:
- **Charts** (optional): [Attach or insert: before/after data chart, trial summary].
- **Images/video**: [Attach: verification photo or short video – trial run, measurement, OK parts].
- **Documents**: [Attach: trial report or test protocol], [Attach: customer confirmation if applicable].

---

## D6 Implement and validate (Implement & Validate)
**Purpose**: Incorporate actions into formal process/standards and confirm implementation.

- Updated documents: SOP, specification, FMEA, control plan, inspection criteria, etc. |
- Scope: Full line/model/supplier base? |
- Effectiveness: Cpk, defect rate, customer feedback. |
- Evidence: Document number, revision, implementation date. |

**Attachments (D6)**:
- **Charts** (optional): [Attach: Cpk or trend chart after implementation].
- **Images** (optional): [Attach: updated work area, gauge, or process photo].
- **Documents**: [Attach: revised SOP/spec/drawing – cover or key page with rev and date], [Attach: approval or change record].

---

## D7 Prevent recurrence (Prevent Recurrence)
**Purpose**: Avoid recurrence of the same type of issue through system changes.

- Process/system changes: Design review, incoming spec, change management, training? |
- Horizontal deployment: Same product/process/supplier/platform reviewed and addressed? |
- Lessons learned: Captured in FMEA, lesson learned database, training material? |

| Category | Content | Owner |
|----------|---------|-------|
| Process/Standard | | |
| Horizontal deployment | | |
| Training/Sharing | | |

**Attachments (D7)** (optional): [Attach: process change summary diagram], [Attach: training photo]. **Documents**: [Attach: training record or attendance], [Attach: lesson learned doc or FMEA update ref].

---

## D8 Congratulate the team and close (Congratulate & Close)
**Purpose**: Recognize contribution, close the case, and close the loop with the customer.

- Team contribution summary: |
- Customer communication and closure: Complaint closed, customer confirmation, evidence filed. |
- Closure date: |
- Report distribution: Quality, Manufacturing, R&D, Customer (as needed). |

**Attachments (D8)** (optional): [Attach: team/customer sign-off photo]. **Documents**: [Attach: customer closure confirmation or email], [Attach: distribution list or acknowledgment].
```

---

## Fill-in hints by D (for model reasoning and user prompts)

**Default (general customers)**:

| D | Keywords | If user did not provide, suggest |
|---|----------|----------------------------------|
| D1 | Cross-functional, leader, members, roles | "Please provide the 8D team members and leader." |
| D2 | 5W2H, defect, quantity, spec | "Please add defect details and quantity/lot information." Suggest: "Attach defect photo(s) and limit sample or spec ref for D2." |
| D3 | Quarantine, 100% inspection, stop, recall, due date | "Please describe containment actions for stock/shipment/production." Optional: "Attach photo of quarantine/sorted lots if available." |
| D4 | Root cause, 5-Why, fishbone, Pareto, verification | "Please provide root cause conclusion or 5-Why/fishbone summary." Suggest: "Add a 5-Why or fishbone diagram; attach reproduction test photo/video if you have it." |
| D5 | Permanent actions, verification result | "Please list selected permanent actions and verification method." Suggest: "Attach verification photo/video and trial report or test protocol." |
| D6 | SOP/spec update, scope, effectiveness | "Please state updated documents and implementation scope." Suggest: "Attach revised SOP/spec (cover or excerpt) and approval evidence." |
| D7 | Horizontal deployment, process improvement, training | "Please describe recurrence prevention and horizontal deployment." Optional: "Attach training record or lesson learned doc ref." |
| D8 | Closure, customer confirmation, filing | "Please confirm closure date and customer sign-off." Optional: "Attach customer closure confirmation and distribution list." |

**Strict customers (Foxconn, automotive OEMs, tier-1, large accounts)** — use these when the user names such a customer or says "strict" / "OEM" / "tier-1". Treat attachments and sign-off as **expected**, not optional:

| D | Strict-customer prompt (additionally or instead) |
|---|---------------------------------------------------|
| D1 | "Please provide the 8D team with **names, departments, and roles**. OEM/Foxconn often require a designated team leader and customer contact." |
| D2 | "**Mandatory for submission**: Defect photo(s), limit sample or customer spec/drawing ref, and **exact lot/batch and defect quantity**. Please attach and confirm spec revision." |
| D3 | "Containment must include **due date** and **effectiveness proof**. Please provide: 100% inspection record or quarantine log, and photo of quarantined/sorted lot if possible." |
| D4 | "**Formal analysis required**: Please provide a 5-Why or fishbone diagram in the report, and **verification of root cause** (reproduction test or data evidence). Attach photo/video of reproduction test if available." |
| D5 | "Permanent corrective actions must have **verification evidence**: trial report, measurement data, or customer approval. Please attach verification photo/video and formal trial or test protocol." |
| D6 | "Please attach **revised document with revision and approval** (SOP/spec/FMEA cover or key page). Provide implementation scope and effectiveness data (e.g. Cpk, defect rate)." |
| D7 | "**Training record or attendance** is typically required. Please attach training record and reference to lesson learned or FMEA update." |
| D8 | "**Customer closure confirmation** (signed or in customer portal) and **distribution list** are required. Please confirm closure date and attach customer approval or acknowledgment." |

**Basic info (strict)**: If strict customer, also ask for **RMA / customer complaint number**, **supplier response due date**, and **cost of quality / cost impact** if the customer form includes them.

---

## Output requirements

1. **Language**: Match the user (e.g. English for English complaints; add bilingual terms if needed).  
2. **Placeholders**: Use `[To be filled]` or `[Fill from context above]` when information is missing; do not invent names, dates, or quantities. For attachments use `[Attach: description]` or `[See diagram]` so the user knows what to add in Word or the report system.
2a. **PPT when requested**: If the user asked for PPT output, the final deliverable must be .pptx or slide-by-slide content — never a .md file. Do not treat PPT as an optional follow-up ("如需导出为PPT随时说").  
3. **Charts/diagrams**: When the user gives 5-Why steps, cause categories, or defect counts by category, generate a text diagram (e.g. indented 5-Why, Mermaid flowchart or mindmap if supported) in the report body so the section is self-contained; still mention attaching the formal diagram file if they have one.  
4. **Images/video/documents**: Keep attachment placeholders explicit; remind the user that images, videos, and document excerpts must be attached when exporting to Word/PPT or uploading the final report.  
5. **File**: Suggest saving as `8D-{case-number}-{date}.md` (Markdown/Word) or `8D-{case-number}-{date}.pptx` (PPT), or to a path specified by the user.  
6. **File link (clickable)**: When a file is saved to disk (.md or .pptx), output the path as a **clickable `file:///` link** so the user can open it directly. Format: `file:///` + absolute path with forward slashes (e.g. `file:///F:/openclaw-skills/8D-CC-001-2025-03-21.pptx`). Say e.g. "已保存，可直接点击打开: [file:///F:/path/to/8D-xxx.pptx](file:///F:/path/to/8D-xxx.pptx)" or "Saved. Click to open: [file:///...]".  
7. **One draft first**: Output one complete template fill-in, then update specific sections based on user additions.

---

## References

- Detailed 8D methodology and tools: `{baseDir}/reference.md` (if present).  
- Example snippets: `{baseDir}/examples/` (if present).
