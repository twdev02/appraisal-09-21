import { ScreeningCategory, PicoQueryPreset } from '../types/screening';

export const SCREENING_CATEGORIES: ScreeningCategory[] = [
  '1. Biliary Stent',
  '2. Esophageal Stent',
  '3. Pyloric/Duodenal Stent',
  '4. Colonic Stent',
  '5. Drainage Stent',
];

export const SUB_MODELS_BY_CATEGORY: Record<ScreeningCategory, string[]> = {
  '1. Biliary Stent': [
    'Niti-S Biliary Uncovered Stent',
    'Niti-S Biliary Covered Stent',
    'ComVi Biliary Stent',
  ],
  '2. Esophageal Stent': ['Niti-S Esophageal Covered Stent'],
  '3. Pyloric/Duodenal Stent': [
    'Niti-S Pyloric/Duodenal Uncovered Stent',
    'Niti-S Pyloric/Duodenal Covered Stent',
    'ComVi Pyloric/Duodenal Stent',
  ],
  '4. Colonic Stent': [
    'Niti-S Enteral Colonic Uncovered Stent',
    'Niti-S Enteral Colonic Covered Stent',
    'ComVi Enteral Colonic Stent',
  ],
  '5. Drainage Stent': [
    'Niti-S SPAXUS Stent',
    'Niti-S Hot SPAXUS Stent',
    'Niti-S Nagi Stent',
  ],
};

export const EXCLUDE_REASONS_LIST = [
  '전체 제외 사유 보기',
  'Literature without human clinical data',
  'Irrelevant article',
  'Different indication',
  'Insufficient information',
  'Held by Taewoong Medical',
];

export function getCategoryPresets(category: ScreeningCategory, subModel?: string): PicoQueryPreset {
  if (category === '1. Biliary Stent') {
    const includeCriteria = `1. Text availability: Full text (Original articles, Reviews, Case reports/series 모두 포함)
2. Species: Human (not animal, artificial simulation)
3. Patient population: Adult patients, irrespective of gender
4. Clinical Conditions: Malignant biliary obstruction/stricture, Benign biliary obstruction/stricture, Benign pancreatic duct stricture
5. Intervention: Biliary SEMS (Uncovered or Covered). Specific Taewoong Medical models: Niti-S (S, D, M, LCD, Full Covered, Both Bare, Giobor, Flare, Kaffes, Bumpy), ComVi (Full Covered, Both Bare, End Bare)
6. Comparators: Surgery, Plastic stent, Balloon dilation, or competitor SEMS (e.g., WallFlex, Evolution, EGIS, Bonastent, Hanarostent)
7. Outcomes: Stent patency, Decreased bilirubin, Technical/Clinical success, Complications, Stent removal (for benign cases)`;

    const excludeCriteria = `1. Species: Not human beings (animal test, artificial simulation, in vitro test)
2. Different indication: Non-biliary/pancreatic target areas only (e.g., vascular, esophageal, colonic, tracheal)
3. Irrelevant articles: Articles not related to biliary/pancreatic luminal stenting or stricture management (e.g., EUS-CDS, EUS-HGS primary LAMS procedures, RFA combined therapies, vascular reconstructions)
4. Non-study publications: Editorials, letters, comments, study protocols (단, Review 및 Case report는 제외하지 않음)
5. Insufficient Information: Valid information relevant to performance and/or safety is limited.
6. Held by Taewoong: This article is already held by Taewoong Medical.`;

    if (subModel === 'Niti-S Biliary Uncovered Stent') {
      return {
        p: 'Biliary obstruction\nBiliary stricture\nMalignant biliary stricture\nMalignant biliary obstruction',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nNiti-S\nUncovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nUncovered stent\nEvolution\nWallFlex\nEGIS\nBonastent\nHanarostent',
        o: 'Stent patency\nDecreased bilirubin',
        addSearchQueries: [
          'Taewoong AND Niti-S AND Biliary AND "S type"',
          'Taewoong AND Niti-S AND Biliary AND "D type"',
          'Taewoong AND Niti-S AND Biliary AND "M type"',
          'Taewoong AND Niti-S AND Biliary AND "LCD type"',
        ],
        includeCriteria,
        excludeCriteria,
      };
    } else if (subModel === 'Niti-S Biliary Covered Stent') {
      return {
        p: 'Biliary obstruction\nBiliary stricture\nBenign biliary stricture\nBenign biliary obstruction\nMalignant biliary stricture\nMalignant biliary obstruction\nBenign pancreatic duct stricture',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nNiti-S\nCovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nCovered stent\nEvolution\nWallFlex\nEGIS\nBonastent\nHanarostent',
        o: 'Stent patency\nDecreased bilirubin\nRemoval',
        addSearchQueries: [
          'Taewoong AND Niti-S AND Biliary AND "Full covered type"',
          'Taewoong AND Niti-S AND Biliary AND "Both bare type"',
          'Taewoong AND Niti-S AND Biliary AND Giobor',
          'Taewoong AND Niti-S AND Biliary AND "Flare type"',
          'Taewoong AND Niti-S AND Biliary AND Kaffes',
          'Taewoong AND Niti-S AND Biliary AND Bumpy',
        ],
        includeCriteria,
        excludeCriteria,
      };
    } else if (subModel === 'ComVi Biliary Stent') {
      return {
        p: 'Biliary obstruction\nBiliary stricture\nMalignant biliary stricture\nMalignant biliary obstruction',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nComVi\nCovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nCovered stent\nEvolution\nWallFlex\nEGIS\nBonastent\nHanarostent',
        o: 'Stent patency\nDecreased bilirubin',
        addSearchQueries: [
          'Taewoong AND ComVi AND Biliary AND "Full covered type"',
          'Taewoong AND ComVi AND Biliary AND "Both bare type"',
          'Taewoong AND ComVi AND Biliary AND "End bare type"',
        ],
        includeCriteria,
        excludeCriteria,
      };
    }
    return {
      p: 'Biliary obstruction\nBiliary stricture\nMalignant biliary stricture\nMalignant biliary obstruction\nBenign biliary obstruction\nBenign biliary stricture\nBenign pancreatic duct stricture',
      i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nNiti-S\nComVi\nUncovered stent\nCovered stent',
      c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nCovered stent\nUncovered stent\nEvolution\nWallFlex\nEGIS\nBonastent\nHanarostent',
      o: 'Stent patency\nDecreased bilirubin\nRemoval',
      addSearchQueries: ['Taewoong AND Biliary AND Stent'],
      includeCriteria,
      excludeCriteria,
    };
  }

  if (category === '2. Esophageal Stent') {
    return {
      p: 'Esophageal stricture\nEsophageal obstruction\nMalignant esophageal stricture\nMalignant esophageal obstruction\nBenign esophageal stricture\nRefractory benign esophageal stricture\nBenign esophageal obstruction\nTracheoesophageal fistula',
      i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nNiti-S\nCovered stent',
      c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nCovered stent\nWallFlex\nUltraflex\nEvolution\nHanarostent\nAixstent\nEGIS\nBonastent\nMicro-tech',
      o: 'Stent patency\nDysphagia improvement\nFistula closure\nRemoval',
      addSearchQueries: [
        'Taewoong AND Niti-S AND Esophageal AND "Full covered type"',
        'Taewoong AND Niti-S AND Esophageal AND Cervical',
        'Taewoong AND Niti-S AND Esophageal AND "Both bare type"',
        'Taewoong AND Niti-S AND Esophageal AND Conio',
        'Taewoong AND Niti-S AND Esophageal AND "Anti reflux"',
        'Taewoong AND Niti-S AND Esophageal AND "Double anti reflux"',
        'Taewoong AND Niti-S AND Esophageal AND "Double type"',
        'Taewoong AND Niti-S AND Esophageal AND Beta-2',
      ],
      includeCriteria: `1. Text availability: Full text (Original articles, Reviews, Case reports/series 모두 포함)
2. Species: Human (not animal, artificial simulation)
3. Patient population: Adult patients, irrespective of gender
4. Clinical Conditions: Esophageal stricture/obstruction (Malignant or Benign), Refractory benign esophageal stricture, Tracheoesophageal fistula (TEF / TE fistula)
5. Intervention: Esophageal SEMS, Covered type. Specific Taewoong Medical models: Niti-S Esophageal (Full covered, Cervical, Both bare type, Conio, Anti reflux, Double anti reflux, Double type, Beta-2)
6. Comparators: Surgery, Plastic stent, Balloon dilation, or competitor SEMS (WallFlex, Ultraflex, Evolution, Hanarostent, Aixstent, EGIS, Bonastent, Micro-Tech)
7. Outcomes: Stent patency, Dysphagia improvement, Fistula closure, Removal (in benign strictures)`,
      excludeCriteria: `1. Species: Not human beings (animal test, artificial simulation, in vitro test)
2. Different indication: Non-esophageal target areas only (e.g., pure systemic/chemotherapy outcomes, non-stricture indications)
3. Irrelevant articles: Articles not related to esophageal stenting, stricture dilation, or TE fistula management
4. Non-study publications: Editorials, letters, comments, study protocols (단, Review 및 Case report는 제외하지 않음)
5. Insufficient Information: Valid information relevant to performance and/or safety is limited.
6. Held by Taewoong: This article is already held by Taewoong Medical.`,
    };
  }

  if (category === '3. Pyloric/Duodenal Stent') {
    const includeCriteria = `1. Text availability: Full text (Original articles, Reviews, Case reports/series 모두 포함)
2. Species: Human (not animal, artificial simulation)
3. Patient population: Adult patients, irrespective of gender
4. Clinical Conditions: Pyloric/Duodenal stricture or obstruction, Gastric Outlet Obstruction (GOO), Malignant or Benign
5. Intervention: Pyloric/Duodenal SEMS, Uncovered or Covered type. Specific Taewoong Medical models: Niti-S Pyloric/Duodenal (D-Type, Full Covered, Both Bare, End Bare), ComVi Pyloric/Duodenal (Flare-Type, Both Bare)
6. Comparators: Surgery, Plastic stent, Balloon dilation, or competitor SEMS (WallFlex, WallFlex Soft, Hanarostent, Evolution, EGIS, Bonastent)
7. Outcomes: Stent patency, Obstruction relief/resolution/improvement, GOOSS score / Oral intake, Technical/Clinical success, Complications, Stent removal`;

    const excludeCriteria = `1. Species: Not human beings (animal test, artificial simulation, in vitro test)
2. Different indication: Non-pyloric/duodenal target areas only
3. Irrelevant articles: Articles not related to pyloric/duodenal stenting or GOO management
4. Non-study publications: Editorials, letters, comments, study protocols
5. Insufficient Information: Valid information relevant to performance and/or safety is limited.
6. Held by Taewoong: This article is already held by Taewoong Medical.`;

    if (subModel === 'Niti-S Pyloric/Duodenal Uncovered Stent') {
      return {
        p: 'Pyloric stricture\nPyloric obstruction\nDuodenal stricture\nDuodenal obstruction\nGastric outlet obstruction\nMalignant pyloric stricture\nMalignant pyloric obstruction\nMalignant duodenal stricture\nMalignant duodenal obstruction',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nNiti-S\nUncovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nUncovered stent\nWallFlex\nWallFlex Soft\nHanarostent\nEvolution\nEGIS\nBonastent',
        o: 'Stent patency\nObstruction relief\nObstruction resolution\nObstruction improvement',
        addSearchQueries: ['Taewoong AND Niti-S AND (Pyloric OR Duodenal) AND "D type"'],
        includeCriteria,
        excludeCriteria,
      };
    } else if (subModel === 'Niti-S Pyloric/Duodenal Covered Stent') {
      return {
        p: 'Pyloric stricture\nPyloric obstruction\nDuodenal stricture\nDuodenal obstruction\nGastric outlet obstruction\nMalignant pyloric stricture\nMalignant pyloric obstruction\nMalignant duodenal stricture\nMalignant duodenal obstruction\nBenign pyloric stricture\nBenign pyloric obstruction\nBenign duodenal stricture\nBenign duodenal obstruction',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nNiti-S\nCovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nCovered stent\nWallFlex\nWallFlex Soft\nHanarostent\nEvolution\nEGIS\nBonastent',
        o: 'Stent patency\nObstruction relief\nObstruction resolution\nObstruction improvement\nRemoval',
        addSearchQueries: [
          'Taewoong AND Niti-S AND (Pyloric OR Duodenal) AND "Full covered type"',
          'Taewoong AND Niti-S AND (Pyloric OR Duodenal) AND "Both bare type"',
          'Taewoong AND Niti-S AND (Pyloric OR Duodenal) AND "End bare type"',
        ],
        includeCriteria,
        excludeCriteria,
      };
    } else if (subModel === 'ComVi Pyloric/Duodenal Stent') {
      return {
        p: 'Pyloric stricture\nPyloric obstruction\nDuodenal stricture\nDuodenal obstruction\nGastric outlet obstruction\nMalignant pyloric stricture\nMalignant pyloric obstruction\nMalignant duodenal stricture\nMalignant duodenal obstruction',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nComVi\nCovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nCovered stent\nWallFlex\nWallFlex Soft\nHanarostent\nEvolution\nEGIS\nBonastent',
        o: 'Stent patency\nObstruction relief\nObstruction resolution\nObstruction improvement',
        addSearchQueries: [
          'Taewoong AND ComVi AND (Pyloric OR Duodenal) AND "Flare type"',
          'Taewoong AND ComVi AND (Pyloric OR Duodenal) AND "Both bare type"',
        ],
        includeCriteria,
        excludeCriteria,
      };
    }
    return {
      p: 'Pyloric stricture\nDuodenal stricture\nGastric outlet obstruction\nMalignant pyloric stricture\nBenign pyloric stricture',
      i: 'SEMS\nTaewoong\nNiti-S\nComVi\nCovered stent\nUncovered stent',
      c: 'Surgery\nPlastic stent\nBalloon dilation\nSEMS\nWallFlex',
      o: 'Stent patency\nObstruction relief\nRemoval',
      addSearchQueries: ['Taewoong AND (Pyloric OR Duodenal) AND Stent'],
      includeCriteria,
      excludeCriteria,
    };
  }

  if (category === '4. Colonic Stent') {
    const includeCriteria = `1. Text availability: Full text (Original articles, Reviews, Case reports/series 모두 포함)
2. Species: Human (not animal, artificial simulation)
3. Patient population: Adult patients, irrespective of gender
4. Clinical Conditions: Colonic/Colorectal stricture or obstruction (Malignant or Benign)
5. Intervention: Colonic SEMS, Uncovered or Covered type. Specific Taewoong Medical models: Niti-S Enteral Colonic (S-Type, D-Type, Full Covered, Both Bare, End Bare), ComVi Enteral Colonic (Both Bare-Type)
6. Comparators: Surgery, Plastic stent, Balloon dilation, or competitor SEMS (WallFlex, WallFlex Soft, Hanarostent, Micro-Tech, Bonastent)
7. Outcomes: Stent patency, Obstruction relief/resolution/improvement, Technical/Clinical success, Complications, Stent removal`;

    const excludeCriteria = `1. Species: Not human beings (animal test, artificial simulation, in vitro test)
2. Different indication: Non-colonic target areas only
3. Irrelevant articles: Articles not related to colonic stenting or colorectal obstruction management
4. Non-study publications: Editorials, letters, comments, study protocols
5. Insufficient Information: Valid information relevant to performance and/or safety is limited.
6. Held by Taewoong: This article is already held by Taewoong Medical.`;

    if (subModel === 'Niti-S Enteral Colonic Uncovered Stent') {
      return {
        p: 'Colonic stricture\nColonic obstruction\nColorectal stricture\nColorectal obstruction\nMalignant colonic stricture\nMalignant colonic obstruction\nMalignant colorectal stricture\nMalignant colorectal obstruction',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nNiti-S\nUncovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nUncovered stent\nWallFlex\nWallFlex Soft\nHanarostent\nMicro-Tech\nBonastent',
        o: 'Stent patency\nObstruction relief\nObstruction resolution\nObstruction improvement',
        addSearchQueries: [
          'Taewoong AND Niti-S AND Colonic AND "S type"',
          'Taewoong AND Niti-S AND Colonic AND "D type"',
        ],
        includeCriteria,
        excludeCriteria,
      };
    } else if (subModel === 'Niti-S Enteral Colonic Covered Stent') {
      return {
        p: 'Colonic stricture\nColonic obstruction\nColorectal stricture\nColorectal obstruction\nMalignant colonic stricture\nMalignant colonic obstruction\nMalignant colorectal stricture\nMalignant colorectal obstruction\nBenign colonic stricture\nBenign colonic obstruction\nBenign colorectal stricture\nBenign colorectal obstruction',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nNiti-S\nCovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nCovered stent\nWallFlex\nWallFlex Soft\nHanarostent\nMicro-Tech\nBonastent',
        o: 'Stent patency\nObstruction relief\nObstruction resolution\nObstruction improvement\nRemoval',
        addSearchQueries: [
          'Taewoong AND Niti-S AND Colonic AND "Full covered type"',
          'Taewoong AND Niti-S AND Colonic AND "Both bare type"',
          'Taewoong AND Niti-S AND Colonic AND "End bare type"',
        ],
        includeCriteria,
        excludeCriteria,
      };
    } else if (subModel === 'ComVi Enteral Colonic Stent') {
      return {
        p: 'Colonic stricture\nColonic obstruction\nColorectal stricture\nColorectal obstruction\nMalignant colonic stricture\nMalignant colonic obstruction\nMalignant colorectal stricture\nMalignant colorectal obstruction',
        i: 'Self-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nTaewoong\nComVi\nCovered stent',
        c: 'Surgery\nPlastic stent\nBalloon dilation\nSelf-expandable metallic stent\nSelf-expandable metal stent\nSEMS\nCovered stent\nWallFlex\nWallFlex Soft\nHanarostent\nMicro-Tech\nBonastent',
        o: 'Stent patency\nObstruction relief\nObstruction resolution\nObstruction improvement',
        addSearchQueries: ['Taewoong AND ComVi AND Colonic AND "Both bare type"'],
        includeCriteria,
        excludeCriteria,
      };
    }
    return {
      p: 'Colonic stricture\nColorectal obstruction\nMalignant colonic stricture\nBenign colonic stricture',
      i: 'SEMS\nTaewoong\nNiti-S\nComVi\nUncovered stent\nCovered stent',
      c: 'Surgery\nPlastic stent\nBalloon dilation\nSEMS\nWallFlex',
      o: 'Stent patency\nObstruction relief\nRemoval',
      addSearchQueries: ['Taewoong AND Colonic AND Stent'],
      includeCriteria,
      excludeCriteria,
    };
  }

  // 5. Drainage Stent
  if (category === '5. Drainage Stent') {
    const includeCriteria = `1. Text availability: Full text (Original articles, Reviews, Case reports/series 모두 포함)
2. Species: Human (not animal, artificial simulation)
3. Patient population: Adult patients, irrespective of gender
4. Clinical Conditions: Pancreatic pseudocyst, Walled-off necrosis (WON) / Pancreatic necrosis, Gallbladder drainage (Cholecystitis) / Biliary tract drainage, Transgastric or transduodenal drainage indications
5. Intervention: Lumen-apposing metal stents (LAMS) or EUS-guided drainage stents. Specific Taewoong Medical models: Niti-S Nagi, Niti-S SPAXUS, Niti-S Hot SPAXUS
6. Comparators: Surgery, Percutaneous drainage, Plastic double-pigtail stents, or competitor LAMS (e.g., AXIOS / Hot AXIOS)
7. Outcomes: Technical/Clinical success rate, Drainage efficacy, Resolution of pseudocyst/necrosis, Complications, Removal rate`;

    const excludeCriteria = `1. Species: Not human beings (animal test, artificial simulation, in vitro test)
2. Different indication: Non-drainage target indications
3. Irrelevant articles: Articles not related to transluminal/EUS-guided drainage or LAMS management
4. Non-study publications: Editorials, letters, comments, study protocols
5. Insufficient Information: Valid information relevant to performance and/or safety is limited.
6. Held by Taewoong: This article is already held by Taewoong Medical.`;

    if (subModel === 'Niti-S SPAXUS Stent') {
      return {
        p: 'Pancreatic pseudocyst\nWalled off necrosis\nGallbladder\nBiliary tract',
        i: 'Self-expandable metallic stent\nSEMS\nLumen apposing metal stent\nLAMS\nEUS gallbladder drainage\nEUS choledochoduodenostomy\nTaewoong\nNiti-S\nSPAXUS',
        c: 'Surgery\nPercutaneous drainage\nSEMS\nLAMS\nAXIOS\nHot AXIOS',
        o: 'Pancreatic pseudocyst drainage\nWalled off necrosis drainage\nGallbladder drainage\nBiliary tract drainage',
        addSearchQueries: ['Taewoong AND Niti-S AND SPAXUS'],
        includeCriteria,
        excludeCriteria,
      };
    } else if (subModel === 'Niti-S Hot SPAXUS Stent') {
      return {
        p: 'Pancreatic pseudocyst\nWalled off necrosis\nGallbladder\nBiliary tract',
        i: 'SEMS\nLumen apposing metal stent\nLAMS\nEUS gallbladder\nEUS choledochoduodenostomy\nElectrocautery delivery system\nHot delivery\nTaewoong\nNiti-S\nHot SPAXUS',
        c: 'Surgery\nPercutaneous drainage\nSEMS\nLAMS\nAXIOS\nHot AXIOS',
        o: 'Pancreatic pseudocyst drainage\nWalled off necrosis drainage\nGallbladder drainage\nBiliary tract drainage',
        addSearchQueries: ['Taewoong AND Niti-S AND "Hot SPAXUS"'],
        includeCriteria,
        excludeCriteria,
      };
    } else if (subModel === 'Niti-S Nagi Stent') {
      return {
        p: 'Pancreatic pseudocyst',
        i: 'SEMS\nLumen apposing metal stent\nLAMS\nBiflanged metal stent\nBFMS\nTaewoong\nNiti-S\nNagi',
        c: 'Surgery\nPercutaneous drainage\nSEMS\nLAMS\nBiflanged metal stent\nBFMS\nAXIOS\nHot AXIOS',
        o: 'Pancreatic pseudocyst drainage',
        addSearchQueries: ['Taewoong AND Niti-S AND Nagi'],
        includeCriteria,
        excludeCriteria,
      };
    }
    return {
      p: 'Pancreatic pseudocyst\nWalled off necrosis\nGallbladder',
      i: 'SEMS\nLAMS\nTaewoong\nNiti-S\nComVi',
      c: 'Surgery\nPercutaneous drainage\nLAMS\nAXIOS',
      o: 'Drainage',
      addSearchQueries: ['Taewoong AND Niti-S AND Drainage'],
      includeCriteria,
      excludeCriteria,
    };
  }

  return {
    p: 'Obstructive Jaundice\nBiliary Stricture',
    i: 'Biliary Stent\nSEMS',
    c: 'Surgery\nPlastic stent',
    o: 'Technical success\nClinical success',
    addSearchQueries: ['Taewoong AND Stent'],
    includeCriteria: 'Include All Relevant Clinical Papers',
    excludeCriteria: 'Exclude Non-Clinical/Irrelevant Papers',
  };
}
