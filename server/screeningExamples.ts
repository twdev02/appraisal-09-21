export interface ScreeningExample {
  title: string;
  decision: 'Include' | 'Exclude';
  reason: string;
}

export const FEW_SHOT_EXAMPLES: ScreeningExample[] = [
  // ==========================================
  // 1. Biliary (담도 스텐트) 예시 모음
  // ==========================================
  {
    title: "Efficacy and safety of covered self-expandable metal stents for malignant hilar biliary obstruction: systematic review and meta-analysis.",
    decision: "Include",
    reason: "The review was included as it assesses the efficacy and safety of CSEMSs in the management of MHBO."
  },
  {
    title: "Uncovered Self-Expandable Metallic Stent with an Ultra-Thin Delivery Sheath in Unresectable Malignant Hilar Biliary Obstruction: A Multicenter Prospective Observational Study.",
    decision: "Include",
    reason: "The study was included as it evaluates outcomes of the transpapillary placement of an uncovered laser-cut SEMS with an ultra-thin delivery sheath for MHBO."
  },
  {
    title: "Endoscopic Stenting for Unresectable Malignant Hilar Biliary Obstruction: Where Do We Stand Today? A Narrative Review.",
    decision: "Include",
    reason: "The review was included as it summarizes the current evidence, clinical practice considerations, and ongoing challenges of endoscopic stenting for unresectable MHBO."
  },
  {
    title: "Covered Versus Uncovered Metal Stents for the Drainage of the Malignant Distal Biliary Obstruction With ERCP: A Systematic Review and Meta-Analysis.",
    decision: "Include",
    reason: "The review was included as it compares different types of SEMS placed by ERCP for the drainage of malignant distal biliary obstruction."
  },

  // ==========================================
  // 2. Esophageal (식도 스텐트) 예시 모음
  // ==========================================
  {
    title: "Endoscopic suturing to prevent migration of esophageal fully covered self-expandable metal stents: a randomized controlled trial (with video).",
    decision: "Include",
    reason: "The study was included as it compared rates of migration and other adverse events after esophageal FC-SEMS placement with and without endoscopic suturing."
  },
  {
    title: "A systematic review and meta-analysis of factors associated with esophageal stent migration and a comparison of antimigration techniques.",
    decision: "Include",
    reason: "The study was included as it presented the largest comprehensive review of the risk factors associated with esophageal stent migration and the interventions leveraged to prevent stent migration."
  },
  {
    title: "Executive Summary of the American Radium Society Appropriate Use Criteria for the Use of Esophageal Stents in Patients With Esophageal Cancer: Systematic Review and Guidelines.",
    decision: "Include",
    reason: "The review was included as it investigated the balance between risks and benefits of stents for patients with malignant dysphagia in a range of clinical scenarios."
  },

  // ==========================================
  // 3. Pyloric/Duodenal (유문/십이지장 스텐트) 예시 모음
  // ==========================================
  {
    title: "Is endoscopic ultrasound-guided gastroenterostomy better than surgical gastrojejunostomy or duodenal stenting?",
    decision: "Include",
    reason: "This review aims to compare EUS-GJ, Duodenal stenting, and Surgical gastrojejunostomy."
  },
  {
    title: "A real-world study of balloon dilation vs. self-expandable metal stents for benign gastric outlet obstruction.",
    decision: "Include",
    reason: "This comparative study presents the safety and efficacy of balloon dilation and SEMS for benign GOO."
  },
  {
    title: "Clinical Outcomes of Secondary Duodenal Self-Expandable Metallic Stenting for Duodenal Stent Dysfunction in Patients with Malignant Duodenal Obstruction: A Retrospective Multicenter Study.",
    decision: "Include",
    reason: "This multicenter study analyzed the clinical outcomes of secondary duodenal SEMS placement for MDO."
  },

  // ==========================================
  // 4. Colonic (대장 스텐트) 예시 모음
  // ==========================================
  {
    title: "Stent as a bridge to surgery for malignant colonic obstruction: a retrospective study on survival and outcomes.",
    decision: "Include",
    reason: "This study evaluates overall survival and outcomes associated with SEMS as a bridge to surgery compared to direct emergency surgery in patients with acute MCO."
  },
  {
    title: "Covered versus uncovered endoluminal stenting in the acute management of obstructing colorectal cancer in the palliative setting: randomized clinical trial (CReST2).",
    decision: "Include",
    reason: "This study assesses whether covered stents used for palliative patients with obstructing colorectal cancer, will result in an improved Quality of Life when compared to uncovered stents."
  },
  {
    title: "Comparative effectiveness of colonic stenting alone and with neoadjuvant chemotherapy for patients with left-sided obstructive colon cancer: a meta-analysis.",
    decision: "Include",
    reason: "This meta-analysis compared the short-term and long-term outcomes between two prevalent treatment approaches: selective surgery following colonic stenting (CS) and colonic stenting combined with neoadjuvant chemotherapy (CS-NAC)."
  },

  // ==========================================
  // 5. Drainage / LAMS (배액/LAMS 스텐트) 예시 모음
  // ==========================================
  {
    title: "The Efficacy and Safety of Endoscopic Ultrasound-Guided Retroperitoneal Fluid Collection Drainage with Novel Electrocautery-Enhanced Lumen-Apposing Metal Stents (with Video).",
    decision: "Include",
    reason: "The study was included as it evaluated the efficacy and safety of this novel electrocautery-enhanced LAMS for managing POPFC and PFC."
  },
  {
    title: "Percutaneous cystogastrostomy for treatment of pancreatic collections.",
    decision: "Include",
    reason: "The study was included as it reported a novel technique involving the creation of an anastomosis between the pancreatic collection and the nearest gastrointestinal loop via a percutaneous approach, followed by balloon dilation to establish communication and placement of drainage in cases of infection."
  },
  {
    title: "Endoscopic ultrasonography guided gallbladder drainage: 'how and when'.",
    decision: "Include",
    reason: "The study was included as it offered a clear and comprehensive perspective on the current role of EUS-GBD, highlighting its potential utility in the routine clinical management of appropriately selected patients."
  },
  {
    title: "Interventional endosonography comes of age: an update on endoscopic ultrasonography-guided drainage and anastomosis procedures.",
    decision: "Include",
    reason: "The review was included as it provided an update on EUS-guided drainage and anastomotic procedures, and other therapeutic procedures."
  },
  {
    title: "Endoscopic Versus Surgical Management for Infected Necrotizing Pancreatitis and Walled-Off Necrosis: A Systematic Review of Randomized Controlled Trials.",
    decision: "Include",
    reason: "The study was included as it synthesized randomized evidence comparing endoscopic and surgical necrosectomy in infected or walled-off necrosis, focusing on mortality, complications, and functional outcomes."
  },

  // ==========================================
  // 6. 대표 Exclude (배ze) 예시 모음
  // ==========================================
  {
    title: "Pilot study of a novel lumen-apposing metal stent for endoscopic ultrasound-guided procedures in porcine models.",
    decision: "Exclude",
    reason: "Literature without result of clinical research on human beings: Preclinical in-vitro / animal study without human clinical safety or performance outcomes."
  },
  {
    title: "Optimal timing for lumen-apposing metal stent removal following endoscopic ultrasound-guided drainage of pancreatic fluid collections: a systematic review and meta-analysis.",
    decision: "Exclude",
    reason: "Insufficient information: Valid information relevant to performance and/or safety is limited."
  },
  {
    title: "Avoiding the complications of endoscopic retrograde cholangiopancreatography.",
    decision: "Exclude",
    reason: "Irrelevant article: The study aimed to review risk factors and prophylactic measures for preventing complications of endoscopic retrograde cholangiopancreatography (ERCP)."
  },
  {
    title: "6-mm vs 10-mm diameter fully covered self-expandable metal stents in patients with unresectable malignant distal bile duct stricture (COSMIC UNISON): study protocol for a multicenter, randomized controlled trial.",
    decision: "Exclude",
    reason: "Insufficient information: Protocol"
  }
];