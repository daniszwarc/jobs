// ── PDF.js worker setup ───────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

// ── Master CV (uploaded per session) ─────────────────────────────────────────

let uploadedCV = null;

async function handleCVUpload(file) {
  if (!file) return;
  const label = document.getElementById('cvFileLabel');
  const badge = document.getElementById('cvBadge');

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    label.textContent = 'Only .pdf supported';
    badge.className = 'cv-badge err';
    badge.textContent = 'error';
    return;
  }

  label.textContent = file.name;
  badge.className = 'cv-badge';
  badge.textContent = 'reading...';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    uploadedCV = text.trim();
    badge.className = 'cv-badge ok';
    badge.textContent = 'loaded';
  } catch (err) {
    label.textContent = 'Error reading PDF';
    badge.className = 'cv-badge err';
    badge.textContent = 'error';
    console.error(err);
  }
}

// ── API Key managed server-side via proxy ─────────────────────────────────

// ── Status helpers ─────────────────────────────────────────────────────────

function setStatus(msg, type = '') {
  const el = document.getElementById('statusBox');
  el.textContent = msg;
  el.className = 'status-box' + (type ? ' ' + type : '');
}

function setSteps(steps, activeIdx) {
  const el = document.getElementById('statusBox');
  el.className = 'status-box';
  el.innerHTML = '<div class="steps">' + steps.map((s, i) => {
    let cls = 'step';
    if (i < activeIdx) cls += ' done';
    else if (i === activeIdx) cls += ' active';
    const icon = i < activeIdx
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
      : (i === activeIdx ? `<div class="spinner"></div>` : `<div class="step-dot"></div>`);
    return `<div class="${cls}"><div class="step-icon">${icon}</div>${s}</div>`;
  }).join('') + '</div>';
}

// ── Clear functions ───────────────────────────────────────────────────────────

function clearJD() {
  document.getElementById('jdInput').value = '';
  document.getElementById('outputBody').innerHTML = `
    <div class="output-empty">
      <div class="empty-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      </div>
      <p>Tailored .docx files will appear here ready to download.</p>
    </div>`;
  setStatus('Paste a job description above, then click generate.');
}

function clearAll() {
  clearJD();
  uploadedCV = null;
  document.getElementById('cvFileInput').value = '';
  document.getElementById('cvFileLabel').textContent = '.pdf';
  document.getElementById('cvBadge').className = 'cv-badge';
  document.getElementById('cvBadge').textContent = 'none';
}

// ── Main generate flow ─────────────────────────────────────────────────────

async function generate() {
  if (!uploadedCV) {
    setStatus('Upload your master CV first (.pdf).', 'error');
    return;
  }
  const jd = document.getElementById('jdInput').value.trim();
  if (!jd) {
    setStatus('Paste a job description first.', 'error');
    return;
  }

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  document.getElementById('outputBody').innerHTML = `
    <div class="output-empty">
      <div class="empty-icon">
        <div class="spinner" style="width:20px;height:20px;border-width:2px"></div>
      </div>
      <p>Building your documents...</p>
    </div>`;

  const steps = [
    'Analyzing job description',
    'Selecting and framing CV content',
    'Drafting cover letter',
    'Assembling .docx files'
  ];

  try {
    setSteps(steps, 0);
    await sleep(300);
    setSteps(steps, 1);

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv_text: uploadedCV, jd })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    setSteps(steps, 2);
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    let cv;
    try {
      cv = JSON.parse(raw);
    } catch (parseErr) {
      console.error('Raw response:', raw);
      throw new Error('Response was cut off -- JSON incomplete. Try again.');
    }

    setSteps(steps, 3);
    await sleep(200);

    const year = new Date().getFullYear();
    const company = (cv.company || 'Company').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');

    const cvBlob = await buildCV(cv);
    const clBlob = await buildCoverLetter(cv);

    renderOutput(cvBlob, clBlob, company, year, cv.brief);
    setStatus('Both files ready.', 'success');

  } catch (e) {
    console.error(e);
    setStatus('Error: ' + e.message, 'error');
    document.getElementById('outputBody').innerHTML = `
      <div class="output-empty">
        <p style="color:var(--error)">Something went wrong. Check the console for details.</p>
      </div>`;
  } finally {
    btn.disabled = false;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Render output ──────────────────────────────────────────────────────────

function renderOutput(cvBlob, clBlob, company, year, brief) {
  const body = document.getElementById('outputBody');
  body.innerHTML = '';

  body.appendChild(makeDownloadCard(
    cvBlob,
    `Daniel_Szwarc_CV_${company}_${year}.docx`,
    'Tailored CV',
    cvIcon()
  ));

  body.appendChild(makeDownloadCard(
    clBlob,
    `Daniel_Szwarc_CoverLetter_${company}_${year}.docx`,
    'Cover Letter',
    mailIcon()
  ));

  if (brief) {
    const box = document.createElement('div');
    box.className = 'notes-box';
    box.innerHTML = `<div class="notes-label">Framing notes</div><div class="notes-text">${escHtml(brief)}</div>`;
    body.appendChild(box);
  }
}

function makeDownloadCard(blob, filename, label, iconSvg) {
  const url = URL.createObjectURL(blob);
  const card = document.createElement('div');
  card.className = 'download-card';
  card.innerHTML = `
    <div class="download-card-icon">${iconSvg}</div>
    <div class="download-card-info">
      <div class="download-card-name">${escHtml(label)}</div>
      <div class="download-card-file">${escHtml(filename)}</div>
    </div>
    <div class="download-card-arrow">${dlIcon()}</div>`;
  card.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  });
  return card;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cvIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
}
function mailIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
}
function dlIcon() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
}

// ── Build CV .docx ─────────────────────────────────────────────────────────

async function buildCV(cv) {
  if (!window.docx) throw new Error('docx library not loaded yet. Please refresh the page.');
  const {
    Document, Packer, Paragraph, TextRun,
    AlignmentType, LevelFormat, BorderStyle, TabStopType
  } = window.docx;

  const ACCENT    = "1B4F8A";
  const GRAY      = "666666";
  const BLACK     = "000000";
  const WIDTH     = 10080;

  const divider = () => new Paragraph({
    spacing: { before: 0, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 1 } },
    children: []
  });

  const section = (t) => new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 22, color: ACCENT, font: "Arial" })]
  });

  const bul = (text) => new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 20, after: 20 },
    children: [new TextRun({ text, size: 18, font: "Arial", color: BLACK })]
  });

  const plain = (text, opts = {}) => new Paragraph({
    spacing: { before: opts.before ?? 20, after: opts.after ?? 20 },
    children: [new TextRun({
      text, size: opts.size ?? 18, font: "Arial",
      color: opts.color ?? BLACK,
      bold: opts.bold ?? false,
      italics: opts.italics ?? false
    })]
  });

  const jobH = (title, co, loc, dates) => new Paragraph({
    spacing: { before: 120, after: 30 },
    tabStops: [{ type: TabStopType.RIGHT, position: WIDTH }],
    children: [
      new TextRun({ text: title, bold: true, size: 20, font: "Arial", color: BLACK }),
      new TextRun({ text: "  |  ", size: 18, font: "Arial", color: GRAY }),
      new TextRun({ text: co, size: 20, font: "Arial", color: ACCENT }),
      new TextRun({ text: "  |  " + loc, size: 18, font: "Arial", color: GRAY }),
      new TextRun({ text: "\t" + dates, size: 18, font: "Arial", color: GRAY })
    ]
  });

  const subH = (text, dates) => {
    const children = [new TextRun({ text, bold: true, size: 19, font: "Arial", color: BLACK })];
    if (dates) children.push(new TextRun({ text: "\t" + dates, size: 18, font: "Arial", color: GRAY }));
    return new Paragraph({
      spacing: { before: 100, after: 20 },
      tabStops: [{ type: TabStopType.RIGHT, position: WIDTH }],
      children
    });
  };

  const projH = (name, label) => new Paragraph({
    spacing: { before: 110, after: 20 },
    children: [
      new TextRun({ text: name, bold: true, size: 19, font: "Arial", color: BLACK }),
      new TextRun({ text: "  " + label, size: 17, font: "Arial", color: GRAY, italics: true })
    ]
  });

  const skillRow = (label, value) => new Paragraph({
    spacing: { before: 24, after: 24 },
    children: [
      new TextRun({ text: label + ": ", bold: true, size: 18, font: "Arial", color: BLACK }),
      new TextRun({ text: value, size: 18, font: "Arial", color: BLACK })
    ]
  });

  // Build experience blocks
  const expBlocks = [];
  const exp = cv.experience || [];
  exp.forEach((e, i) => {
    if (e.type === 'primary' || i === 0) {
      expBlocks.push(jobH(e.title, e.company, e.location, e.dates));
      (e.bullets || []).forEach(b => expBlocks.push(bul(b)));
    } else if (e.type === 'consulting_intro') {
      expBlocks.push(subH(e.title + "  |  " + e.company, e.dates));
      expBlocks.push(plain(e.bullets?.[0] || '', { before: 20, after: 30 }));
      (e.bullets?.slice(1) || []).forEach(b => expBlocks.push(bul(b)));
    } else {
      expBlocks.push(subH(e.title, e.dates));
      (e.bullets || []).forEach(b => expBlocks.push(bul(b)));
    }
  });

  const children = [
    // Header
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 },
      children: [new TextRun({ text: "DANIEL SZWARC", bold: true, size: 40, font: "Arial", color: BLACK })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 },
      children: [new TextRun({ text: cv.role_title || "AI Automation Engineer  |  Full-Stack Developer", size: 22, font: "Arial", color: ACCENT })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: "Montreal, Quebec  |  514.220.4421  |  dani@thiez.com  |  linkedin.com/in/daniszwarc  |  github.com/daniszwarc", size: 17, font: "Arial", color: GRAY })]
    }),
    divider(),
    // Summary
    section("Professional Summary"),
    plain(cv.summary || ''),
    divider(),
    // Projects
    section("Current AI Projects"),
    ...(cv.projects || []).flatMap(p => [
      projH(p.name, p.label),
      ...(p.bullets || []).map(b => bul(b))
    ]),
    divider(),
    // Experience
    section("Professional Experience"),
    ...expBlocks,
    divider(),
    // Skills
    section("Technical Skills"),
    ...(cv.skills || []).map(s => skillRow(s.label, s.value)),
    divider(),
    // Education
    section("Education"),
    subH("Master of Science in Artificial Intelligence (Expected 2026)", "2024 - Present"),
    plain("University of Liverpool, England", { before: 0, after: 10, color: GRAY }),
    plain("Dissertation: WorkflowSynth -- LLM-guided programme synthesis with formal verification for enterprise workflows", { before: 0, after: 20, color: GRAY, italics: true }),
    subH("Microcomputer Programming & Web Developer Certificates", "1999 - 2001"),
    plain("Centennial College, Toronto, ON", { before: 0, after: 20, color: GRAY }),
    plain("Earlier studies in Electronic Engineering, Sound Design, and Technical Electronics -- Buenos Aires, Argentina (1985-1993)", { before: 20, after: 20, color: GRAY, italics: true }),
    divider(),
    // Certs
    section("Certifications & Professional Development"),
    bul("LangChain Developer Certification  |  LangChain Inc."),
    bul("Agentic RAG Specialization  |  Coursera"),
    bul("AI & Automation Specializations  |  Coursera / Udemy"),
  ];

  const doc = new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } } }
        }]
      }]
    },
    styles: { default: { document: { run: { font: "Arial", size: 18 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children
    }]
  });

  return Packer.toBlob(doc);
}

// ── Build Cover Letter .docx ───────────────────────────────────────────────

async function buildCoverLetter(cv) {
  if (!window.docx) throw new Error('docx library not loaded yet. Please refresh the page.');
  const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = window.docx;

  const ACCENT = "1B4F8A";
  const GRAY   = "666666";
  const BLACK  = "000000";

  const para = (text, opts = {}) => new Paragraph({
    spacing: { before: opts.before ?? 0, after: opts.after ?? 200 },
    children: [new TextRun({
      text, size: opts.size ?? 21, font: "Arial",
      color: opts.color ?? BLACK,
      bold: opts.bold ?? false
    })]
  });

  const cl = cv.cover_letter || {};
  const month = new Date().toLocaleString('default', { month: 'long' });
  const year  = new Date().getFullYear();

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 21 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 },
          children: [new TextRun({ text: "DANIEL SZWARC", bold: true, size: 36, font: "Arial", color: BLACK })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 },
          children: [new TextRun({ text: "Montreal, Quebec  |  514.220.4421  |  dani@thiez.com  |  linkedin.com/in/daniszwarc", size: 17, font: "Arial", color: GRAY })]
        }),
        new Paragraph({
          spacing: { before: 0, after: 240 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 1 } },
          children: []
        }),
        para(`${month} ${year}`, { after: 200, color: GRAY, size: 19 }),
        para(cv.company || "Hiring Team", { after: 20 }),
        para("", { after: 200 }),
        para(cl.salutation || "Hi,", { after: 240 }),
        para(cl.para1 || "", { after: 220 }),
        para(cl.para2 || "", { after: 220 }),
        para(cl.para3 || "", { after: 220 }),
        para(cl.para4 || "", { after: 340 }),
        para("Best,", { after: 220 }),
        para("Daniel Szwarc", { after: 0, bold: true }),
      ]
    }]
  });

  return Packer.toBlob(doc);
}
