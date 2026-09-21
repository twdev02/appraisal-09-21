import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  AlignmentType,
  WidthType,
  ShadingType,
  VerticalAlign,
  BorderStyle,
  PageBreak,
} from 'docx';
import { saveAs } from 'file-saver';
import {
  FullAppraisalData,
  MethodologicalAppraisalState,
  ContributionAppraisalState,
  OverallAppraisalState,
  SuitabilityAppraisalState,
  RelevanceAppraisalState,
  ResearchGroup,
  DueItem,
  ArticleMetadata,
} from '../types';
import { calculateOverallAppraisal } from '../data/appraisalStandards';

// ==========================================
// Color & Styling Constants (Exact PDF Palette)
// ==========================================
const COLORS = {
  HEADER_BG: 'F0F4E8', // Light sage/olive header box background from PDF
  HEADER_BORDER: 'CBD5E1', // Neutral border
  TH_BG: 'F2F4F7', // Table header row light grey
  BORDER: 'D1D5DB', // Standard cell border
  BORDER_DARK: '9CA3AF',
  TEXT_DARK: '111827',
  TEXT_MUTED: '4B5563',
  TEXT_LIGHT: '6B7280',

  // Grade highlighting bands (from PDF screenshots)
  TIER_EXCELLENT: '85B8EB', // Blue
  TIER_VERY_GOOD: 'C5DCF5', // Light blue
  TIER_GOOD: 'FFFFFF', // White
  TIER_POOR: 'FCE4E4', // Pink / Rose

  // Result box
  ACCEPTED_BG: 'E6F4EA',
  ACCEPTED_TEXT: '137333',
  REJECTED_BG: 'FCE8E6',
  REJECTED_TEXT: 'C5221F',
};

const DEFAULT_FONT = 'Arial';
const TABLE_CELL_MARGINS = { top: 90, bottom: 90, left: 130, right: 130 };

const STANDARD_CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.BORDER },
  left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.BORDER },
  right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.BORDER },
};

/**
 * Main Word (.docx) Export Function
 * Replicates the official Appraisal Plan PDF layout with 100% fidelity.
 */
export async function exportAppraisalPlanDocx(
  data: FullAppraisalData,
  methodological: MethodologicalAppraisalState,
  contribution: ContributionAppraisalState
) {
  const overall: OverallAppraisalState = calculateOverallAppraisal(
    data.suitability.totalScoreUser,
    methodological.totalScoreUser,
    contribution.totalScoreUser
  );

  const dueList: DueItem[] =
    data.dueList && data.dueList.length > 0
      ? data.dueList
      : data.due
      ? [data.due]
      : [];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: DEFAULT_FONT,
            size: 19, // 9.5 pt
            color: COLORS.TEXT_DARK,
          },
          paragraph: {
            spacing: { line: 260, before: 0, after: 0 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1000, // 0.7 inch
              bottom: 1000,
              left: 1000,
              right: 1000,
            },
          },
        },
        children: [
          // -------------------------------------------------------------
          // Top Document Header: Article Identification & DUE Setup
          // -------------------------------------------------------------
          createDocumentTitleHeader(data.articleMetadata, dueList, data.pdfFileName),
          new Paragraph({ text: '', spacing: { after: 180 } }),

          // -------------------------------------------------------------
          // PAGE 1 OF PDF: Appraisal Criteria for Suitability
          // -------------------------------------------------------------
          createSectionHeaderBox(
            'Appraisal Criteria for Suitability',
            'Appraisal Reference: IMDRF MDCE WG/N56FINAL:2019’s Appendices D1'
          ),
          createSuitabilityTable(data.suitability),
          new Paragraph({ text: '', spacing: { after: 120 } }),
          createAcceptanceCriteriaBox(
            'Acceptance criteria: The total Methodological result should be Very Good or Excellent.',
            `Suitability Result: ${data.suitability.gradeUser} (${data.suitability.totalScoreUser}/11)`
          ),

          // Page Break for Section 2 (PDF Page 2)
          new Paragraph({
            children: [new PageBreak()],
            spacing: { before: 100 },
          }),

          // -------------------------------------------------------------
          // PAGE 2 OF PDF: Relevance Appraisal
          // -------------------------------------------------------------
          createSectionHeaderBox(
            'Relevance Appraisal',
            'Appraisal Reference: MEDDEV 2.7.1 (Rev.4)’s Section 9.3.2 c)’s table'
          ),
          createRelevanceTable(data.relevance, data.researchGroups, dueList),

          // Page Break for Section 3 (PDF Page 3)
          new Paragraph({
            children: [new PageBreak()],
            spacing: { before: 100 },
          }),

          // -------------------------------------------------------------
          // PAGE 3 OF PDF: Methodological Appraisal
          // -------------------------------------------------------------
          createSectionHeaderBox(
            'Methodological Appraisal',
            'Appraisal Reference: MEDDEV 2.7.1 (Rev.4)’s Appendix 6.'
          ),
          createMethodologicalTable(methodological, data.researchGroups, data),
          new Paragraph({ text: '', spacing: { after: 120 } }),
          createAcceptanceCriteriaBox(
            'Acceptance criteria: The total Methodological result should be Very Good or Excellent.',
            `Methodological Result: ${methodological.gradeUser} (${methodological.totalScoreUser}/12)`
          ),

          // Page Break for Section 4 (PDF Page 4)
          new Paragraph({
            children: [new PageBreak()],
            spacing: { before: 100 },
          }),

          // -------------------------------------------------------------
          // PAGE 4 OF PDF: Appraisal Criteria for Data Contribution & Overall Appraisal
          // -------------------------------------------------------------
          createSectionHeaderBox(
            'Appraisal Criteria for Data Contribution',
            'Appraisal Reference: IMDRF MDCE WG/N56FINAL:2019’s Appendices D1'
          ),
          createContributionTable(contribution, data.researchGroups),
          new Paragraph({ text: '', spacing: { after: 120 } }),
          createAcceptanceCriteriaBox(
            'Acceptance criteria: The total Methodological result should be Very Good or Excellent.',
            `Data Contribution Result: ${contribution.gradeUser} (${contribution.totalScoreUser}/10)`
          ),
          new Paragraph({ text: '', spacing: { after: 200 } }),

          // Overall Appraisal (Bottom of Page 4)
          createSectionHeaderBox(
            'Overall Appraisal',
            'The overall appraisal shall totalize the result of the Methodological appraisal (12), the relevance appraisal (11), and the contribution appraisal (10).'
          ),
          createOverallTable(overall),
          new Paragraph({ text: '', spacing: { after: 120 } }),
          createOverallAcceptanceBox(overall),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const cleanDueName = ((dueList[0]?.productName) || 'Clinical_Appraisal').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanDocTitle = (data.articleMetadata.title || data.pdfFileName || 'Literature')
    .slice(0, 35)
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  saveAs(blob, `Appraisal_Plan_${cleanDueName}_${cleanDocTitle}.docx`);
}

// =========================================================================
// SECTION HEADER BOX (Exact Olive/Sage Title Bar from PDF)
// =========================================================================
function createSectionHeaderBox(title: string, reference: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: COLORS.HEADER_BG },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 6, color: COLORS.HEADER_BORDER },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.HEADER_BORDER },
              left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.HEADER_BORDER },
              right: { style: BorderStyle.SINGLE, size: 6, color: COLORS.HEADER_BORDER },
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: title,
                    bold: true,
                    size: 22, // 11pt
                    color: COLORS.TEXT_DARK,
                  }),
                ],
                spacing: { after: 30 },
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: reference,
                    size: 18, // 9pt
                    color: COLORS.TEXT_MUTED,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// =========================================================================
// DOCUMENT TITLE & LITERATURE IDENTIFICATION
// =========================================================================
function createDocumentTitleHeader(
  meta: ArticleMetadata,
  dueList: DueItem[],
  pdfFileName?: string
): Table {
  const articleTitle = meta.title || pdfFileName || 'Clinical Literature Evaluation';
  const citationLine = [
    meta.authors ? `Authors: ${meta.authors}` : '',
    meta.journal ? `Journal: ${meta.journal}` : '',
    meta.publicationYear ? `Year: ${meta.publicationYear}` : '',
    meta.doi ? `DOI: ${meta.doi}` : '',
  ]
    .filter(Boolean)
    .join('  |  ');

  const dueLine = dueList.length > 0
    ? dueList.map((d) => `${d.productName || 'DUE'}${d.indications?.length ? ` [Indication: ${d.indications.join(', ')}]` : ''}`).join('; ')
    : 'Not configured';

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
              left: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
              right: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
            },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'CLINICAL LITERATURE APPRAISAL PLAN & EVALUATION REPORT',
                    bold: true,
                    size: 24, // 12pt
                    color: '0F172A',
                  }),
                ],
                spacing: { after: 60 },
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: 'Article Title: ', bold: true, size: 19 }),
                  new TextRun({ text: articleTitle, size: 19, bold: true, color: '1E293B' }),
                ],
                spacing: { after: 30 },
              }),
              ...(citationLine
                ? [
                    new Paragraph({
                      children: [
                        new TextRun({ text: 'Citation: ', bold: true, size: 18, color: COLORS.TEXT_MUTED }),
                        new TextRun({ text: citationLine, size: 18, color: COLORS.TEXT_MUTED }),
                      ],
                      spacing: { after: 30 },
                    }),
                  ]
                : []),
              new Paragraph({
                children: [
                  new TextRun({ text: 'Target DUE: ', bold: true, size: 18, color: '1E40AF' }),
                  new TextRun({ text: dueLine, size: 18, color: '1E40AF' }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// =========================================================================
// ACCEPTANCE CRITERIA BANNERS
// =========================================================================
function createAcceptanceCriteriaBox(acceptanceText: string, statusText?: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: 'F9FAFB' },
            margins: { top: 80, bottom: 80, left: 130, right: 130 },
            borders: STANDARD_CELL_BORDERS,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: acceptanceText,
                    bold: true,
                    size: 18,
                    color: COLORS.TEXT_DARK,
                  }),
                  ...(statusText
                    ? [
                        new TextRun({
                          text: `   [${statusText}]`,
                          bold: true,
                          size: 18,
                          color: '1E40AF',
                        }),
                      ]
                    : []),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function createOverallAcceptanceBox(overall: OverallAppraisalState): Table {
  const isAccepted = overall.overallResult === 'Accepted';
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: 'F9FAFB' },
            margins: TABLE_CELL_MARGINS,
            borders: STANDARD_CELL_BORDERS,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Acceptance criteria',
                    bold: true,
                    size: 19,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 75, type: WidthType.PERCENTAGE },
            shading: {
              type: ShadingType.CLEAR,
              fill: isAccepted ? COLORS.ACCEPTED_BG : COLORS.REJECTED_BG,
            },
            margins: TABLE_CELL_MARGINS,
            borders: STANDARD_CELL_BORDERS,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'The overall result should be Very Good or Excellent.',
                    size: 19,
                    bold: true,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Final Regulatory Outcome: ${overall.overallResult.toUpperCase()}  |  Total Score: ${overall.totalScore} / ${overall.maxTotalScore}  |  Overall Grade: ${overall.overallGrade}`,
                    bold: true,
                    size: 19,
                    color: isAccepted ? COLORS.ACCEPTED_TEXT : COLORS.REJECTED_TEXT,
                  }),
                ],
                spacing: { before: 40 },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// =========================================================================
// 1. SUITABILITY TABLE (PDF PAGE 1)
// =========================================================================
function createSuitabilityTable(suitability: SuitabilityAppraisalState): Table {
  const items = [
    {
      key: 'appropriateDevice',
      title: 'Appropriate Device:',
      question: 'Were the data generated from the device in question?',
      item: suitability.appropriateDevice,
      options: [
        { weight: '2', label: 'Device under evaluation' },
        { weight: '1', label: 'Equivalent device or\nBenchmark/Similar device' },
        { weight: '0', label: 'Other devices and medical\nalternatives' },
      ],
    },
    {
      key: 'appropriateDeviceApplication',
      title: 'Appropriate device application:',
      question: 'Was the device used for the same intended use (e.g., methods of deployment,\napplication, etc.)?',
      item: suitability.appropriateDeviceApplication,
      options: [
        { weight: '3', label: 'Same use' },
        { weight: '2', label: 'Minor deviation' },
        { weight: '1', label: 'Major deviation' },
      ],
    },
    {
      key: 'appropriatePatientGroup',
      title: 'Appropriate patient group:',
      question: 'Was the data generated from a patient group that is representative of the intended\ntreatment population (e.g., age, sex, etc.) and clinical condition (i.e., disease, including\nstate and severity)?',
      item: suitability.appropriatePatientGroup,
      options: [
        { weight: '3', label: 'Applicable' },
        { weight: '2', label: 'Limited' },
        { weight: '1', label: 'Different population' },
      ],
    },
    {
      key: 'acceptableReportDataCollation',
      title: 'Acceptable report / data collation:',
      question: 'Do the reports or collations of data contain sufficient information to be able to\nundertake a rational and objective assessment?',
      item: suitability.acceptableReportDataCollation,
      options: [
        { weight: '3', label: 'High quality' },
        { weight: '2', label: 'Minor deficiencies' },
        { weight: '1', label: 'Insufficient information' },
      ],
    },
  ];

  const rows: TableRow[] = [
    // Header Row
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 55, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'Suitability Criteria: Description', bold: true, size: 19 }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: 12, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'Weight', bold: true, size: 19 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 33, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Description', bold: true, size: 19 })],
            }),
          ],
        }),
      ],
    }),
  ];

  // Render each criterion item
  items.forEach((crit) => {
    const userSelected = crit.item.userFinalSelection || '';
    const userScore = crit.item.userFinalScore;

    const col1Paragraphs: Paragraph[] = [
      new Paragraph({
        children: [new TextRun({ text: crit.title, bold: true, size: 19 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: crit.question, size: 18, color: COLORS.TEXT_DARK })],
        spacing: { after: 50 },
      }),
    ];

    // Add supporting evidence & English remarks cleanly inside Col 1
    if (crit.item.evidence.quote) {
      col1Paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Evidence: `, bold: true, size: 17, color: COLORS.TEXT_MUTED }),
            new TextRun({ text: `"${crit.item.evidence.quote}"`, italics: true, size: 17, color: COLORS.TEXT_MUTED }),
            ...(crit.item.evidence.location
              ? [new TextRun({ text: ` [${crit.item.evidence.location}]`, bold: true, size: 17, color: COLORS.TEXT_MUTED })]
              : []),
          ],
          spacing: { before: 30, after: 20 },
        })
      );
    }

    if (crit.item.comment && crit.item.comment.trim() !== 'None' && crit.item.comment.trim() !== '') {
      col1Paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Remarks: `, bold: true, size: 17, color: COLORS.TEXT_DARK }),
            new TextRun({ text: crit.item.comment, size: 17, color: COLORS.TEXT_DARK }),
          ],
          spacing: { after: 20 },
        })
      );
    }

    crit.options.forEach((opt, optIdx) => {
      // Check if this option is selected
      const isSelected =
        userSelected.toLowerCase().includes(opt.label.split('\n')[0].toLowerCase().trim()) ||
        String(userScore) === opt.weight;

      const checkPrefix = isSelected ? '☑ ' : '☐ ';

      const optDescParagraphs = opt.label.split('\n').map((line, lIdx) =>
        new Paragraph({
          children: [
            new TextRun({
              text: lIdx === 0 ? `${checkPrefix}${line}` : `   ${line}`,
              bold: isSelected,
              size: 19,
              color: isSelected ? '0F172A' : COLORS.TEXT_DARK,
            }),
          ],
        })
      );

      if (optIdx === 0) {
        rows.push(
          new TableRow({
            children: [
              new TableCell({
                rowSpan: crit.options.length,
                width: { size: 55, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.TOP,
                children: col1Paragraphs,
              }),
              new TableCell({
                width: { size: 12, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: opt.weight,
                        bold: isSelected,
                        size: 19,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 33, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: optDescParagraphs,
              }),
            ],
          })
        );
      } else {
        rows.push(
          new TableRow({
            children: [
              new TableCell({
                width: { size: 12, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: opt.weight,
                        bold: isSelected,
                        size: 19,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 33, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: optDescParagraphs,
              }),
            ],
          })
        );
      }
    });
  });

  // Total and Grading Bands (Exact PDF layout and colors)
  const totalBands = [
    { range: '10 to 11', grade: 'Excellent', fill: COLORS.TIER_EXCELLENT },
    { range: '8 to 9', grade: 'Very Good', fill: COLORS.TIER_VERY_GOOD },
    { range: '6 to 7', grade: 'Good', fill: COLORS.TIER_GOOD },
    { range: '3 to 5', grade: 'Poor', fill: COLORS.TIER_POOR },
  ];

  totalBands.forEach((band, bIdx) => {
    const isUserGrade = suitability.gradeUser === band.grade;
    if (bIdx === 0) {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              rowSpan: 4,
              width: { size: 55, type: WidthType.PERCENTAGE },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Total', bold: true, size: 20 }),
                    new TextRun({
                      text: `   [User Score: ${suitability.totalScoreUser} / 11 (${suitability.gradeUser})]`,
                      bold: true,
                      size: 19,
                      color: '1E40AF',
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 12, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: band.range,
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 33, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: band.grade + (isUserGrade ? '  ★ (Final)' : ''),
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    } else {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 12, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: band.range,
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 33, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: band.grade + (isUserGrade ? '  ★ (Final)' : ''),
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    }
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// =========================================================================
// 2. RELEVANCE TABLE (PDF PAGE 2)
// =========================================================================
function createRelevanceTable(
  relevance: RelevanceAppraisalState,
  researchGroups: ResearchGroup[],
  dueList: DueItem[]
): Table {
  // Construct helper texts for treatment groups
  const groupsSummaryLines: string[] = [];
  if (researchGroups.length > 0) {
    researchGroups.forEach((g) => {
      const devNames = g.devices.map((d) => `${d.deviceProductName} (${d.manufacturer || 'Mfg not reported'})`).join(', ');
      groupsSummaryLines.push(`${g.groupName} (N = ${g.groupPatientNumber || 'N/A'}): ${devNames}`);
    });
  }

  const items = [
    {
      description: 'To what extent are the data generated representative of the device under evaluation?',
      item: relevance.itemA_representativeness,
      examples: [
        'Device under evaluation',
        'Equivalent device',
        'Benchmark/Similar device',
        'Other devices and medical alternatives',
        'Data concerning the medical conditions that are managed with the device',
      ],
      customComment: [
        ...(groupsSummaryLines.length > 0 ? [`Research Groups:`, ...groupsSummaryLines] : []),
      ],
    },
    {
      description: 'What aspects are covered?',
      item: relevance.itemB_aspectsCovered,
      examples: [
        'Pivotal performance data',
        'Pivotal safety data',
        'Claims',
        'Identification of hazards',
        'Estimation and management of risks',
        'Establishment of current knowledge / the state of the art',
        'Determination and justification of criteria for the evaluation of the risk/benefit relationship',
        'Determination and justification of criteria for the evaluation of acceptability of undesirable side-effects',
        'Determination of equivalence',
        'Justification of the validity of surrogate endpoints',
      ],
    },
    {
      description: 'Are the data relevant to the intended purpose of the device or to claims about the device?',
      item: relevance.itemC_intendedPurposeClaims,
      examples: [
        'Representative of the entire intended purpose with all patient populations and all claims foreseen for the device under evaluation',
        'Concerns specific models / sizes / settings, or concerns specific aspects of the intended purpose or of claims',
        'Does not concern the intended purpose or claims',
      ],
    },
    {
      description: '- Model, size, or setting of the device?',
      item: relevance.itemD_modelSizeSetting,
      examples: [
        'Smallest / intermediate / largest size',
        'Lowest / intermediate / highest dose',
        'Etc.',
      ],
      customComment: researchGroups.flatMap((g) =>
        g.devices.map(
          (d) => `${g.groupName} - ${d.deviceProductName}: Diameter ${d.diameter || 'N/R'}, Length ${d.length || 'N/R'}`
        )
      ),
    },
    {
      description: '- User group?',
      item: relevance.itemE_userGroup,
      examples: [
        'Specialists',
        'General practitioners',
        'Nurses',
        'Adult healthy lay persons',
        'Disabled persons',
        'Children',
        'Etc.',
      ],
    },
    {
      description: '- Medical indication (if applicable)?',
      item: relevance.itemF_medicalIndication,
      examples: [
        'Migraine prophylaxis',
        'Treatment of acute migraine',
        'Rehabilitation after stroke',
        'Etc.',
      ],
      customComment: researchGroups.flatMap((g) =>
        g.devices.map(
          (d) => `${g.groupName}: ${d.deviceIndication || 'Not reported'} [Classification: ${d.indicationRelationship.userFinal}]`
        )
      ),
    },
    {
      description: '- Age group?',
      item: relevance.itemG_ageGroup,
      examples: [
        'pre-term infants / neonates / children / adolescents / adults / old age',
      ],
    },
    {
      description: '- Gender?',
      item: relevance.itemH_gender,
      examples: ['Female/ male'],
    },
    {
      description: '- Type and severity of the medical condition?',
      item: relevance.itemI_typeSeverityCondition,
      examples: [
        'Early / late stage',
        'Mild / intermediate / serious form',
        'Acute / chronic phase',
        'Etc.',
      ],
    },
    {
      description: '- Range of time?',
      item: relevance.itemJ_rangeOfTime,
      examples: [
        'Duration of application or use',
        'Number of repeat exposures',
        'Duration of follow-up',
      ],
      customComment: [
        ...(relevance.itemJ_rangeOfTime.rangeOfTimeDetails?.durationOfApplicationOrUse
          ? [`Application/Use: ${relevance.itemJ_rangeOfTime.rangeOfTimeDetails.durationOfApplicationOrUse}`]
          : []),
        ...(relevance.itemJ_rangeOfTime.rangeOfTimeDetails?.durationOfFollowUp
          ? [`Follow-up: ${relevance.itemJ_rangeOfTime.rangeOfTimeDetails.durationOfFollowUp}`]
          : []),
      ],
    },
  ];

  const rows: TableRow[] = [
    // Header Row
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Description', bold: true, size: 19 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 36, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Examples', bold: true, size: 19 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 6, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: '√', bold: true, size: 19 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 28, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Comment', bold: true, size: 19 })],
            }),
          ],
        }),
      ],
    }),
  ];

  items.forEach((entry) => {
    const userSelections = entry.item.userSelectedOptions || [];

    // Build comment paragraphs
    const commentParagraphs: Paragraph[] = [];

    if (entry.customComment && entry.customComment.length > 0) {
      entry.customComment.forEach((line) => {
        commentParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: line, size: 17, color: '0F172A' })],
            spacing: { after: 20 },
          })
        );
      });
    }

    if (entry.item.evidence.quote) {
      commentParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Evidence: `, bold: true, size: 16, color: COLORS.TEXT_MUTED }),
            new TextRun({ text: `"${entry.item.evidence.quote}"`, italics: true, size: 16, color: COLORS.TEXT_MUTED }),
            ...(entry.item.evidence.location
              ? [new TextRun({ text: ` [${entry.item.evidence.location}]`, bold: true, size: 16, color: COLORS.TEXT_MUTED })]
              : []),
          ],
          spacing: { before: 20, after: 20 },
        })
      );
    }

    if (entry.item.comment && entry.item.comment.trim() !== 'None' && entry.item.comment.trim() !== '') {
      entry.item.comment.split('\n').forEach((cLine) => {
        if (cLine.trim()) {
          commentParagraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `Remarks: `, bold: true, size: 16 }),
                new TextRun({ text: cLine.trim(), size: 16 }),
              ],
              spacing: { after: 20 },
            })
          );
        }
      });
    }

    if (commentParagraphs.length === 0) {
      commentParagraphs.push(new Paragraph({ text: '-' }));
    }

    entry.examples.forEach((exampleText, exIdx) => {
      const isChecked = userSelections.some(
        (sel) =>
          sel.toLowerCase().trim() === exampleText.toLowerCase().trim() ||
          exampleText.toLowerCase().includes(sel.toLowerCase().trim())
      );

      const checkMarkText = isChecked ? '☑' : '☐';

      if (exIdx === 0) {
        rows.push(
          new TableRow({
            children: [
              new TableCell({
                rowSpan: entry.examples.length,
                width: { size: 30, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.TOP,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: entry.description,
                        bold: true,
                        size: 18,
                        color: COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 36, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: exampleText,
                        bold: isChecked,
                        size: 18,
                        color: isChecked ? '0F172A' : COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 6, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: checkMarkText,
                        bold: isChecked,
                        size: 20,
                        color: isChecked ? '1E40AF' : COLORS.TEXT_LIGHT,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                rowSpan: entry.examples.length,
                width: { size: 28, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.TOP,
                children: commentParagraphs,
              }),
            ],
          })
        );
      } else {
        rows.push(
          new TableRow({
            children: [
              new TableCell({
                width: { size: 36, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: exampleText,
                        bold: isChecked,
                        size: 18,
                        color: isChecked ? '0F172A' : COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 6, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: checkMarkText,
                        bold: isChecked,
                        size: 20,
                        color: isChecked ? '1E40AF' : COLORS.TEXT_LIGHT,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          })
        );
      }
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// =========================================================================
// 3. METHODOLOGICAL TABLE (PDF PAGE 3)
// =========================================================================
function createMethodologicalTable(
  methodological: MethodologicalAppraisalState,
  researchGroups: ResearchGroup[],
  fullData: FullAppraisalData
): Table {
  // Construct patient number breakdown per treatment group
  const patientGroupsBreakdown: string[] = [];
  if (researchGroups.length > 0) {
    researchGroups.forEach((g) => {
      patientGroupsBreakdown.push(`${g.groupName}: ${g.groupPatientNumber || 'Not separately reported'} patients`);
    });
  }

  const items = [
    {
      aspect: 'Information on elementary aspects',
      item: methodological.informationElementary,
      options: [
        { label: 'Adequate (2)', scoreVal: 2 },
        { label: 'Non adequate (1)', scoreVal: 1 },
      ],
      customSubElements: methodological.informationElementary.subElements,
    },
    {
      aspect: 'Patients number',
      item: methodological.patientsNumber,
      options: [
        { label: 'High(30-) (2)', scoreVal: 2 },
        { label: 'Medium(11-29) (1)', scoreVal: 1 },
        { label: 'Poor(1-10) (0)', scoreVal: 0 },
      ],
      customLines: patientGroupsBreakdown,
    },
    {
      aspect: 'Statistical method(s)',
      item: methodological.statisticalMethods,
      options: [
        { label: 'Adequate (2)', scoreVal: 2 },
        { label: 'Non adequate (1)', scoreVal: 1 },
      ],
    },
    {
      aspect: 'Adequate controls',
      item: methodological.adequateControls,
      options: [
        { label: 'Adequate (2)', scoreVal: 2 },
        { label: 'Non adequate (1)', scoreVal: 1 },
      ],
    },
    {
      aspect: 'Collection of mortality and serious adverse events data',
      item: methodological.collectionMortalityAE,
      options: [
        { label: 'Adequate (2)', scoreVal: 2 },
        { label: 'Non adequate (1)', scoreVal: 1 },
      ],
      safetySummary: fullData.safety?.summary,
    },
    {
      aspect: 'Interpretation of the authors',
      item: methodological.interpretationAuthors,
      options: [
        { label: 'Good (1)', scoreVal: 1 },
        { label: 'Misinterpretation (0)', scoreVal: 0 },
      ],
    },
    {
      aspect: 'Study legality',
      item: methodological.studyLegality,
      options: [
        { label: 'Legal (1)', scoreVal: 1 },
        { label: 'Illegal (0)', scoreVal: 0 },
      ],
    },
  ];

  const rows: TableRow[] = [
    // Header Row
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 36, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Aspects covered', bold: true, size: 19 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 24, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Weight', bold: true, size: 19 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 40, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Remarks', bold: true, size: 19 })],
            }),
          ],
        }),
      ],
    }),
  ];

  items.forEach((entry) => {
    const userSelection = entry.item.userFinalSelection || '';
    const userScore = entry.item.userFinalScore;

    // Build Remarks paragraphs
    const remarksParagraphs: Paragraph[] = [];

    // Custom lines (e.g. Patient number per treatment group)
    if (entry.customLines && entry.customLines.length > 0) {
      entry.customLines.forEach((line) => {
        remarksParagraphs.push(
          new Paragraph({
            children: [new TextRun({ text: line, bold: true, size: 17, color: '0F172A' })],
            spacing: { after: 20 },
          })
        );
      });
    }

    // Sub-elements if present
    if (entry.customSubElements && entry.customSubElements.length > 0) {
      remarksParagraphs.push(
        new Paragraph({
          children: [new TextRun({ text: 'Elementary Items:', bold: true, size: 16, color: COLORS.TEXT_MUTED })],
          spacing: { before: 20, after: 10 },
        })
      );
      entry.customSubElements.forEach((sub, sIdx) => {
        remarksParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: `• ${sub.label}: `, bold: true, size: 16 }),
              new TextRun({ text: `${sub.value || (sub.reported ? 'Reported' : 'Not reported')}`, size: 16 }),
            ],
          })
        );
      });
    }

    // Safety summary if present for Item 5
    if (entry.safetySummary) {
      const s = entry.safetySummary;
      remarksParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Mortality: `, bold: true, size: 16 }),
            new TextRun({ text: `${s.overallMortality || 'Not reported'}  |  `, size: 16 }),
            new TextRun({ text: `SAEs: `, bold: true, size: 16 }),
            new TextRun({ text: `${s.overallSeriousAdverseEvents || 'Not reported'}`, size: 16 }),
          ],
          spacing: { before: 20, after: 20 },
        })
      );
    }

    // Supporting Evidence Quote & Location
    if (entry.item.evidence.quote) {
      remarksParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Evidence: `, bold: true, size: 16, color: COLORS.TEXT_MUTED }),
            new TextRun({ text: `"${entry.item.evidence.quote}"`, italics: true, size: 16, color: COLORS.TEXT_MUTED }),
            ...(entry.item.evidence.location
              ? [new TextRun({ text: ` [${entry.item.evidence.location}]`, bold: true, size: 16, color: COLORS.TEXT_MUTED })]
              : []),
          ],
          spacing: { before: 30, after: 20 },
        })
      );
    }

    // English Remarks from program
    if (entry.item.comment && entry.item.comment.trim() !== 'None' && entry.item.comment.trim() !== '') {
      entry.item.comment.split('\n').forEach((cLine) => {
        if (cLine.trim()) {
          remarksParagraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `Remarks: `, bold: true, size: 16 }),
                new TextRun({ text: cLine.trim(), size: 16 }),
              ],
              spacing: { after: 20 },
            })
          );
        }
      });
    }

    if (remarksParagraphs.length === 0) {
      remarksParagraphs.push(new Paragraph({ text: '-' }));
    }

    entry.options.forEach((opt, optIdx) => {
      const isSelected =
        userSelection.toLowerCase().includes(opt.label.toLowerCase().split(' ')[0]) ||
        userScore === opt.scoreVal;

      const checkPrefix = isSelected ? '☑ ' : '☐ ';

      if (optIdx === 0) {
        rows.push(
          new TableRow({
            children: [
              new TableCell({
                rowSpan: entry.options.length,
                width: { size: 36, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.TOP,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: entry.aspect,
                        bold: true,
                        size: 19,
                        color: COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 24, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `${checkPrefix}${opt.label}`,
                        bold: isSelected,
                        size: 19,
                        color: isSelected ? '0F172A' : COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                rowSpan: entry.options.length,
                width: { size: 40, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.TOP,
                children: remarksParagraphs,
              }),
            ],
          })
        );
      } else {
        rows.push(
          new TableRow({
            children: [
              new TableCell({
                width: { size: 24, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `${checkPrefix}${opt.label}`,
                        bold: isSelected,
                        size: 19,
                        color: isSelected ? '0F172A' : COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          })
        );
      }
    });
  });

  // Total and Grading Bands (Exact PDF layout and colors)
  const totalBands = [
    { range: '10 to 12', grade: 'Excellent', fill: COLORS.TIER_EXCELLENT },
    { range: '8 to 9', grade: 'Very Good', fill: COLORS.TIER_VERY_GOOD },
    { range: '6 to 7', grade: 'Good', fill: COLORS.TIER_GOOD },
    { range: '4 to 5', grade: 'Poor', fill: COLORS.TIER_POOR },
  ];

  totalBands.forEach((band, bIdx) => {
    const isUserGrade = methodological.gradeUser === band.grade;
    if (bIdx === 0) {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              rowSpan: 4,
              width: { size: 36, type: WidthType.PERCENTAGE },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Total', bold: true, size: 20 }),
                    new TextRun({
                      text: `   [User Score: ${methodological.totalScoreUser} / 12 (${methodological.gradeUser})]`,
                      bold: true,
                      size: 19,
                      color: '1E40AF',
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 24, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: band.range,
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 40, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: band.grade + (isUserGrade ? '  ★ (Final)' : ''),
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    } else {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 24, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: band.range,
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 40, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: band.grade + (isUserGrade ? '  ★ (Final)' : ''),
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    }
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// =========================================================================
// 4. DATA CONTRIBUTION TABLE (PDF PAGE 4 TOP)
// =========================================================================
function createContributionTable(
  contribution: ContributionAppraisalState,
  researchGroups: ResearchGroup[]
): Table {
  const followUpLines: string[] = [];
  if (researchGroups.length > 0) {
    researchGroups.forEach((g) => {
      followUpLines.push(`${g.groupName}: Follow-up duration reported`);
    });
  }

  const items = [
    {
      title: 'Data source type:',
      question: 'Was the design of the study appropriate?',
      item: contribution.dataSourceType,
      options: [
        { label: 'Yes (2)', scoreVal: 2 },
        { label: 'No (1)', scoreVal: 1 },
      ],
    },
    {
      title: 'Outcome measures:',
      question: 'Does the outcome measures reported reflect the intended performance of the device?',
      item: contribution.outcomeMeasures,
      options: [
        { label: 'Yes (2)', scoreVal: 2 },
        { label: 'No (1)', scoreVal: 1 },
      ],
    },
    {
      title: 'Follow up:',
      question: 'Long enough to assess whether duration of treatment effects and identify\ncomplications?',
      item: contribution.followUp,
      options: [
        { label: 'Yes (2)', scoreVal: 2 },
        { label: 'No (1)', scoreVal: 1 },
      ],
    },
    {
      title: 'Statistical significance:',
      question: 'Has a statistical analysis of the data been provided and is it appropriate?',
      item: contribution.statisticalSignificance,
      options: [
        { label: 'Yes (2)', scoreVal: 2 },
        { label: 'No (1)', scoreVal: 1 },
      ],
    },
    {
      title: 'Clinical significance:',
      question: 'Was the magnitude of the treatment effect observed clinically significant?',
      item: contribution.clinicalSignificance,
      options: [
        { label: 'Yes (2)', scoreVal: 2 },
        { label: 'No (1)', scoreVal: 1 },
      ],
    },
  ];

  const rows: TableRow[] = [
    // Header Row
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 45, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'Contribution Criteria: Description', bold: true, size: 19 }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Weight', bold: true, size: 19 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 35, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.TH_BG },
          margins: TABLE_CELL_MARGINS,
          borders: STANDARD_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Remarks', bold: true, size: 19 })],
            }),
          ],
        }),
      ],
    }),
  ];

  items.forEach((entry) => {
    const userSelection = entry.item.userFinalSelection || '';
    const userScore = entry.item.userFinalScore;

    const remarksParagraphs: Paragraph[] = [];

    if (entry.item.evidence.quote) {
      remarksParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Evidence: `, bold: true, size: 16, color: COLORS.TEXT_MUTED }),
            new TextRun({ text: `"${entry.item.evidence.quote}"`, italics: true, size: 16, color: COLORS.TEXT_MUTED }),
            ...(entry.item.evidence.location
              ? [new TextRun({ text: ` [${entry.item.evidence.location}]`, bold: true, size: 16, color: COLORS.TEXT_MUTED })]
              : []),
          ],
          spacing: { before: 20, after: 20 },
        })
      );
    }

    if (entry.item.comment && entry.item.comment.trim() !== 'None' && entry.item.comment.trim() !== '') {
      entry.item.comment.split('\n').forEach((cLine) => {
        if (cLine.trim()) {
          remarksParagraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `Remarks: `, bold: true, size: 16 }),
                new TextRun({ text: cLine.trim(), size: 16 }),
              ],
              spacing: { after: 20 },
            })
          );
        }
      });
    }

    if (remarksParagraphs.length === 0) {
      remarksParagraphs.push(new Paragraph({ text: '-' }));
    }

    entry.options.forEach((opt, optIdx) => {
      const isSelected =
        userSelection.toLowerCase().startsWith(opt.label.toLowerCase().slice(0, 3)) ||
        userScore === opt.scoreVal;

      const checkPrefix = isSelected ? '☑ ' : '☐ ';

      if (optIdx === 0) {
        rows.push(
          new TableRow({
            children: [
              new TableCell({
                rowSpan: entry.options.length,
                width: { size: 45, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.TOP,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: entry.title,
                        bold: true,
                        size: 19,
                        color: COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: entry.question,
                        size: 18,
                        color: COLORS.TEXT_DARK,
                      }),
                    ],
                    spacing: { after: 30 },
                  }),
                ],
              }),
              new TableCell({
                width: { size: 20, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `${checkPrefix}${opt.label}`,
                        bold: isSelected,
                        size: 19,
                        color: isSelected ? '0F172A' : COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                rowSpan: entry.options.length,
                width: { size: 35, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.TOP,
                children: remarksParagraphs,
              }),
            ],
          })
        );
      } else {
        rows.push(
          new TableRow({
            children: [
              new TableCell({
                width: { size: 20, type: WidthType.PERCENTAGE },
                margins: TABLE_CELL_MARGINS,
                borders: STANDARD_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `${checkPrefix}${opt.label}`,
                        bold: isSelected,
                        size: 19,
                        color: isSelected ? '0F172A' : COLORS.TEXT_DARK,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          })
        );
      }
    });
  });

  // Total and Grading Bands (Exact PDF layout and colors)
  const totalBands = [
    { range: '10', grade: 'Excellent', fill: COLORS.TIER_EXCELLENT },
    { range: '8 to 9', grade: 'Very Good', fill: COLORS.TIER_VERY_GOOD },
    { range: '6 to 7', grade: 'Good', fill: COLORS.TIER_GOOD },
    { range: '5', grade: 'Poor', fill: COLORS.TIER_POOR },
  ];

  totalBands.forEach((band, bIdx) => {
    const isUserGrade = contribution.gradeUser === band.grade;
    if (bIdx === 0) {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              rowSpan: 4,
              width: { size: 45, type: WidthType.PERCENTAGE },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Total', bold: true, size: 20 }),
                    new TextRun({
                      text: `   [User Score: ${contribution.totalScoreUser} / 10 (${contribution.gradeUser})]`,
                      bold: true,
                      size: 19,
                      color: '1E40AF',
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 20, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: band.range,
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: band.grade + (isUserGrade ? '  ★ (Final)' : ''),
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    } else {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 20, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: band.range,
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: band.grade + (isUserGrade ? '  ★ (Final)' : ''),
                      bold: isUserGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    }
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// =========================================================================
// 5. OVERALL APPRAISAL TABLE (PDF PAGE 4 BOTTOM)
// =========================================================================
function createOverallTable(overall: OverallAppraisalState): Table {
  const bands = [
    { range: '31 to 33', grade: 'Excellent', fill: COLORS.TIER_EXCELLENT },
    { range: '26 to 30', grade: 'Very Good', fill: COLORS.TIER_VERY_GOOD },
    { range: '20 to 25', grade: 'Good', fill: COLORS.TIER_GOOD },
    { range: '12 to 19', grade: 'Poor', fill: COLORS.TIER_POOR },
  ];

  const rows: TableRow[] = [];

  bands.forEach((band, bIdx) => {
    const isUserOverallGrade = overall.overallGrade === band.grade;

    if (bIdx === 0) {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              rowSpan: 4,
              width: { size: 25, type: WidthType.PERCENTAGE },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: 'Overall', bold: true, size: 22 }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: `Score: ${overall.totalScore} / ${overall.maxTotalScore}`,
                      bold: true,
                      size: 18,
                      color: '1E40AF',
                    }),
                  ],
                  spacing: { before: 30 },
                }),
              ],
            }),
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: band.range,
                      bold: isUserOverallGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 40, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: band.grade + (isUserOverallGrade ? '  ★ (Final Result)' : ''),
                      bold: isUserOverallGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    } else {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: band.range,
                      bold: isUserOverallGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 40, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: band.fill },
              margins: TABLE_CELL_MARGINS,
              borders: STANDARD_CELL_BORDERS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: band.grade + (isUserOverallGrade ? '  ★ (Final Result)' : ''),
                      bold: isUserOverallGrade,
                      size: 19,
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    }
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

/**
 * Batch Word (.docx) Export Function for Multiple Completed Articles.
 */
export async function exportBatchAppraisalDocx(
  completedArticles: { data: FullAppraisalData; methodological: MethodologicalAppraisalState; contribution: ContributionAppraisalState }[]
) {
  if (!completedArticles || completedArticles.length === 0) return;

  const children: any[] = [];

  completedArticles.forEach((art, artIdx) => {
    const data = art.data;
    const methodological = art.methodological;
    const contribution = art.contribution;

    const overall: OverallAppraisalState = calculateOverallAppraisal(
      data.suitability.totalScoreUser,
      methodological.totalScoreUser,
      contribution.totalScoreUser
    );

    const dueList: DueItem[] =
      data.dueList && data.dueList.length > 0
        ? data.dueList
        : data.due
        ? [data.due]
        : [];

    if (artIdx > 0) {
      children.push(
        new Paragraph({
          children: [new PageBreak()],
          spacing: { before: 100 },
        })
      );
    }

    children.push(
      createDocumentTitleHeader(data.articleMetadata, dueList, data.pdfFileName),
      new Paragraph({ text: '', spacing: { after: 180 } }),
      createSectionHeaderBox(
        `Article ${artIdx + 1}: Appraisal Criteria for Suitability`,
        'Appraisal Reference: IMDRF MDCE WG/N56FINAL:2019’s Appendices D1'
      ),
      createSuitabilityTable(data.suitability),
      new Paragraph({ text: '', spacing: { after: 120 } }),
      createAcceptanceCriteriaBox(
        'Acceptance criteria: The total Methodological result should be Very Good or Excellent.',
        `Suitability Result: ${data.suitability.gradeUser} (${data.suitability.totalScoreUser}/11)`
      ),
      new Paragraph({ children: [new PageBreak()], spacing: { before: 100 } }),
      createSectionHeaderBox(
        `Article ${artIdx + 1}: Relevance Appraisal`,
        'Appraisal Reference: MEDDEV 2.7.1 (Rev.4)’s Section 9.3.2 c)’s table'
      ),
      createRelevanceTable(data.relevance, data.researchGroups, dueList),
      new Paragraph({ children: [new PageBreak()], spacing: { before: 100 } }),
      createSectionHeaderBox(
        `Article ${artIdx + 1}: Methodological Appraisal`,
        'Appraisal Reference: MEDDEV 2.7.1 (Rev.4)’s Appendix 6.'
      ),
      createMethodologicalTable(methodological, data.researchGroups, data),
      new Paragraph({ text: '', spacing: { after: 120 } }),
      createAcceptanceCriteriaBox(
        'Acceptance criteria: The total Methodological result should be Very Good or Excellent.',
        `Methodological Result: ${methodological.gradeUser} (${methodological.totalScoreUser}/12)`
      ),
      new Paragraph({ children: [new PageBreak()], spacing: { before: 100 } }),
      createSectionHeaderBox(
        `Article ${artIdx + 1}: Appraisal Criteria for Data Contribution`,
        'Appraisal Reference: IMDRF MDCE WG/N56FINAL:2019’s Appendices D1'
      ),
      createContributionTable(contribution, data.researchGroups),
      new Paragraph({ text: '', spacing: { after: 120 } }),
      createAcceptanceCriteriaBox(
        'Acceptance criteria: The total Methodological result should be Very Good or Excellent.',
        `Data Contribution Result: ${contribution.gradeUser} (${contribution.totalScoreUser}/10)`
      ),
      new Paragraph({ text: '', spacing: { after: 200 } }),
      createSectionHeaderBox(
        `Article ${artIdx + 1}: Overall Appraisal`,
        'The overall appraisal shall totalize the result of the Methodological appraisal (12), the relevance appraisal (11), and the contribution appraisal (10).'
      ),
      createOverallTable(overall),
      new Paragraph({ text: '', spacing: { after: 120 } }),
      createOverallAcceptanceBox(overall)
    );
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: DEFAULT_FONT, size: 19, color: COLORS.TEXT_DARK },
          paragraph: { spacing: { line: 260, before: 0, after: 0 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `Appraisal_Batch_Report_${completedArticles.length}_articles.docx`);
}
