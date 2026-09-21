export interface ProductModelItem {
  id: string;
  name: string;
  fullName: string;
  imageFileName: string;
  indication: string;
  stentType: 'Uncovered' | 'Covered' | 'ComVi' | 'LAMS' | 'BFMS';
  customImageUrl?: string;
}

export interface ProductCatalogSubTab {
  id: string;
  subTabName: string;
  models: ProductModelItem[];
}

export interface ProductCategoryGroup {
  category: string;
  displayName: string;
  headerTitle: string;
  subTabs: ProductCatalogSubTab[];
}

export const PRODUCT_CATALOG_GROUPS: ProductCategoryGroup[] = [
  // 1. Biliary Stent
  {
    category: 'Biliary',
    displayName: 'Biliary Stent',
    headerTitle: 'Niti-S & ComVi Biliary Stent',
    subTabs: [
      {
        id: 'biliary-uncovered',
        subTabName: 'Uncovered Stent',
        models: [
          {
            id: 'biliary_uncovered_s',
            name: 'S-Type',
            fullName: 'Niti-S Biliary Uncovered Stent [S-Type]',
            imageFileName: 'biliary_uncovered_s.png',
            stentType: 'Uncovered',
            indication: 'Niti-S Biliary Uncovered Stent [S-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'biliary_uncovered_d',
            name: 'D-Type',
            fullName: 'Niti-S Biliary Uncovered Stent [D-Type]',
            imageFileName: 'biliary_uncovered_d.png',
            stentType: 'Uncovered',
            indication: 'Niti-S Biliary Uncovered Stent [D-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'biliary_uncovered_m',
            name: 'M-Type',
            fullName: 'Niti-S Biliary Uncovered Stent [M-Type]',
            imageFileName: 'biliary_uncovered_m.png',
            stentType: 'Uncovered',
            indication: 'Niti-S Biliary Uncovered Stent [M-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'biliary_uncovered_lcd',
            name: 'LCD-Type',
            fullName: 'Niti-S Biliary Uncovered Stent [LCD-Type]',
            imageFileName: 'biliary_uncovered_lcd.png',
            stentType: 'Uncovered',
            indication: 'Niti-S Biliary Uncovered Stent [LCD-Type] is indicated for use in malignant strictures.',
          },
        ],
      },
      {
        id: 'biliary-covered',
        subTabName: 'Covered Stent',
        models: [
          {
            id: 'biliary_covered_full',
            name: 'Full Covered-Type',
            fullName: 'Niti-S Biliary Covered Stent [Full Covered-Type]',
            imageFileName: 'biliary_covered_full.png',
            stentType: 'Covered',
            indication: 'Niti-S Biliary Covered Stent [Full Covered-Type] is indicated for use in malignant and/or benign strictures.',
          },
          {
            id: 'biliary_covered_bothbare',
            name: 'Both Bare-Type',
            fullName: 'Niti-S Biliary Covered Stent [Both Bare-Type]',
            imageFileName: 'biliary_covered_bothbare.png',
            stentType: 'Covered',
            indication: 'Niti-S Biliary Covered Stent [Both Bare-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'biliary_covered_giobor',
            name: 'Giobor',
            fullName: 'Niti-S Biliary Covered Stent [Giobor]',
            imageFileName: 'biliary_covered_giobor.png',
            stentType: 'Covered',
            indication: 'Niti-S Biliary Covered Stent [Giobor] is indicated for use in malignant strictures.',
          },
          {
            id: 'biliary_covered_flare',
            name: 'Flare-Type',
            fullName: 'Niti-S Biliary Covered Stent [Flare-Type]',
            imageFileName: 'biliary_covered_flare.png',
            stentType: 'Covered',
            indication: 'Niti-S Biliary Covered Stent [Flare-Type] is indicated for use in malignant and/or benign strictures.',
          },
          {
            id: 'biliary_covered_kaffes',
            name: 'Kaffes',
            fullName: 'Niti-S Biliary Covered Stent [Kaffes]',
            imageFileName: 'biliary_covered_kaffes.png',
            stentType: 'Covered',
            indication: 'Niti-S Biliary Covered Stent [Kaffes] is indicated for use in malignant and/or benign strictures.',
          },
          {
            id: 'biliary_covered_bumpy',
            name: 'Bumpy',
            fullName: 'Niti-S Biliary Covered Stent [Bumpy]',
            imageFileName: 'biliary_covered_bumpy.png',
            stentType: 'Covered',
            indication: 'Niti-S Biliary Covered Stent [Bumpy] is indicated for use in malignant and/or benign biliary strictures and benign pancreatic ductal strictures.',
          },
        ],
      },
      {
        id: 'biliary-comvi',
        subTabName: 'ComVi Stent',
        models: [
          {
            id: 'biliary_comvi_full',
            name: 'Full Covered-Type',
            fullName: 'ComVi Biliary Stent [Full Covered-Type]',
            imageFileName: 'biliary_comvi_full.png',
            stentType: 'ComVi',
            indication: 'ComVi Biliary Stent [Full Covered-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'biliary_comvi_bothbare',
            name: 'Both Bare-Type',
            fullName: 'ComVi Biliary Stent [Both Bare-Type]',
            imageFileName: 'biliary_comvi_bothbare.png',
            stentType: 'ComVi',
            indication: 'ComVi Biliary Stent [Both Bare-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'biliary_comvi_endbare',
            name: 'End Bare-Type',
            fullName: 'ComVi Biliary Stent [End Bare-Type]',
            imageFileName: 'biliary_comvi_endbare.png',
            stentType: 'ComVi',
            indication: 'ComVi Biliary Stent [End Bare-Type] is indicated for use in malignant strictures.',
          },
        ],
      },
    ],
  },

  // 2. Esophageal Stent
  {
    category: 'Esophageal',
    displayName: 'Esophageal Stent',
    headerTitle: 'Niti-S Esophageal Stent',
    subTabs: [
      {
        id: 'esophageal-covered',
        subTabName: 'Covered Stent',
        models: [
          {
            id: 'esophageal_covered_full',
            name: 'Full Covered-Type',
            fullName: 'Niti-S Esophageal Covered Stent [Full Covered-Type]',
            imageFileName: 'esophageal_covered_full.png',
            stentType: 'Covered',
            indication: 'Niti-S Esophageal Covered Stent [Full Covered-Type] is indicated for use in malignant and/or refractory benign stricture and tracheoesophageal fistula.',
          },
          {
            id: 'esophageal_covered_cervical',
            name: 'Cervical',
            fullName: 'Niti-S Esophageal Covered Stent [Cervical]',
            imageFileName: 'esophageal_covered_cervical.png',
            stentType: 'Covered',
            indication: 'Niti-S Esophageal Covered Stent [Cervical] is indicated for use in malignant strictures.',
          },
          {
            id: 'esophageal_covered_bothbare',
            name: 'Both Bare-Type',
            fullName: 'Niti-S Esophageal Covered Stent [Both Bare-Type]',
            imageFileName: 'esophageal_covered_bothbare.png',
            stentType: 'Covered',
            indication: 'Niti-S Esophageal Covered Stent [Both Bare-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'esophageal_covered_conio',
            name: 'Conio',
            fullName: 'Niti-S Esophageal Covered Stent [Conio]',
            imageFileName: 'esophageal_covered_conio.png',
            stentType: 'Covered',
            indication: 'Niti-S Esophageal Covered Stent [Conio] is indicated for use in malignant and/or benign stricture and tracheoesophageal fistula.',
          },
          {
            id: 'esophageal_covered_antireflux',
            name: 'Anti Reflux-Type',
            fullName: 'Niti-S Esophageal Covered Stent [Anti Reflux-Type]',
            imageFileName: 'esophageal_covered_antireflux.png',
            stentType: 'Covered',
            indication: 'Niti-S Esophageal Covered Stent [Anti Reflux-Type] is indicated for use in malignant and/or benign stricture and tracheoesophageal fistula.',
          },
          {
            id: 'esophageal_covered_doubleantireflux',
            name: 'Double Anti Reflux-Type',
            fullName: 'Niti-S Esophageal Covered Stent [Double Anti-Reflux-Type]',
            imageFileName: 'esophageal_covered_doubleantireflux.png',
            stentType: 'Covered',
            indication: 'Niti-S Esophageal Covered Stent [Double Anti-Reflux-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'esophageal_covered_double',
            name: 'Double-Type',
            fullName: 'Niti-S Esophageal Covered Stent [Double-Type]',
            imageFileName: 'esophageal_covered_double.png',
            stentType: 'Covered',
            indication: 'Niti-S Esophageal Covered Stent [Double-Type] is indicated for use in malignant strictures.',
          },
          {
            id: 'esophageal_covered_beta2',
            name: 'Beta-2',
            fullName: 'Niti-S Esophageal Covered Stent [Beta-2]',
            imageFileName: 'esophageal_covered_beta2.png',
            stentType: 'Covered',
            indication: 'Niti-S Esophageal Covered Stent [Beta-2] is indicated for use in malignant and/or benign stricture and tracheoesophageal fistula.',
          },
        ],
      },
    ],
  },

  // 3. Pyloric/Duodenal Stent
  {
    category: 'Pyloric/Duodenal',
    displayName: 'Pyloric/Duodenal Stent',
    headerTitle: 'Niti-S & ComVi Pyloric/Duodenal Stent',
    subTabs: [
      {
        id: 'pyloric-uncovered',
        subTabName: 'Uncovered Stent',
        models: [
          {
            id: 'pyloric_uncovered_d',
            name: 'D-Type',
            fullName: 'Niti-S Pyloric/Duodenal Uncovered Stent [D-Type]',
            imageFileName: 'pyloric_uncovered_d.png',
            stentType: 'Uncovered',
            indication: 'Niti-S Pyloric/Duodenal Uncovered Stent [D-Type] is indicated for use in intrinsic and/or extrinsic malignant stricture.',
          },
        ],
      },
      {
        id: 'pyloric-covered',
        subTabName: 'Covered Stent',
        models: [
          {
            id: 'pyloric_covered_full',
            name: 'Full Covered-Type',
            fullName: 'Niti-S Pyloric/Duodenal Covered Stent [Full Covered-Type]',
            imageFileName: 'pyloric_covered_full.png',
            stentType: 'Covered',
            indication: 'Niti-S Pyloric/Duodenal Covered Stent [Full Covered-Type] is indicated for use in intrinsic and/or extrinsic malignant and/or benign stricture.',
          },
          {
            id: 'pyloric_covered_bothbare',
            name: 'Both Bare-Type',
            fullName: 'Niti-S Pyloric/Duodenal Covered Stent [Both Bare-Type]',
            imageFileName: 'pyloric_covered_bothbare.png',
            stentType: 'Covered',
            indication: 'Niti-S Pyloric/Duodenal Covered Stent [Both Bare-Type] is indicated for use in intrinsic and/or extrinsic malignant stricture.',
          },
          {
            id: 'pyloric_covered_endbare',
            name: 'End Bare-Type',
            fullName: 'Niti-S Pyloric/Duodenal Covered Stent [End Bare-Type]',
            imageFileName: 'pyloric_covered_endbare.png',
            stentType: 'Covered',
            indication: 'Niti-S Pyloric/Duodenal Covered Stent [End Bare-Type] is indicated for use in intrinsic and/or extrinsic malignant stricture.',
          },
        ],
      },
      {
        id: 'pyloric-comvi',
        subTabName: 'ComVi Stent',
        models: [
          {
            id: 'pyloric_comvi_flare',
            name: 'Flare-Type',
            fullName: 'ComVi Pyloric/Duodenal Stent [Flare-Type]',
            imageFileName: 'pyloric_comvi_flare.png',
            stentType: 'ComVi',
            indication: 'ComVi Pyloric/Duodenal Stent [Flare-Type] is indicated for use in intrinsic and/or extrinsic malignant stricture.',
          },
          {
            id: 'pyloric_comvi_bothbare',
            name: 'Both Bare-Type',
            fullName: 'ComVi Pyloric/Duodenal Stent [Both Bare-Type]',
            imageFileName: 'pyloric_comvi_bothbare.png',
            stentType: 'ComVi',
            indication: 'ComVi Pyloric/Duodenal Stent [Both Bare-Type] is indicated for use in intrinsic and/or extrinsic malignant stricture.',
          },
        ],
      },
    ],
  },

  // 4. Colonic Stent
  {
    category: 'Colonic',
    displayName: 'Colonic Stent',
    headerTitle: 'Niti-S & ComVi Enteral Colonic Stent',
    subTabs: [
      {
        id: 'colonic-uncovered',
        subTabName: 'Uncovered Stent',
        models: [
          {
            id: 'colonic_uncovered_s',
            name: 'S-Type',
            fullName: 'Niti-S Enteral Colonic Uncovered Stent [S-Type]',
            imageFileName: 'colonic_uncovered_s.png',
            stentType: 'Uncovered',
            indication: 'Niti-S Enteral Colonic Uncovered Stent [S-Type] is indicated for use in colon stricture caused by intrinsic and/or extrinsic malignant stricture.',
          },
          {
            id: 'colonic_uncovered_d',
            name: 'D-Type',
            fullName: 'Niti-S Enteral Colonic Uncovered Stent [D-Type]',
            imageFileName: 'colonic_uncovered_d.png',
            stentType: 'Uncovered',
            indication: 'Niti-S Enteral Colonic Uncovered Stent [D-Type] is indicated for use in colon stricture caused by intrinsic and/or extrinsic malignant stricture.',
          },
        ],
      },
      {
        id: 'colonic-covered',
        subTabName: 'Covered Stent',
        models: [
          {
            id: 'colonic_covered_full',
            name: 'Full Covered-Type',
            fullName: 'Niti-S Enteral Colonic Covered Stent [Full Covered-Type]',
            imageFileName: 'colonic_covered_full.png',
            stentType: 'Covered',
            indication: 'Niti-S Enteral Colonic Covered Stent [Full Covered-Type] is indicated for use in colon stricture caused by intrinsic and/or extrinsic malignant and/or benign stricture.',
          },
          {
            id: 'colonic_covered_bothbare',
            name: 'Both Bare-Type',
            fullName: 'Niti-S Enteral Colonic Covered Stent [Both Bare-Type]',
            imageFileName: 'colonic_covered_bothbare.png',
            stentType: 'Covered',
            indication: 'Niti-S Enteral Colonic Covered Stent [Both Bare-Type] is indicated for use in colon stricture caused by intrinsic and/or extrinsic malignant stricture.',
          },
          {
            id: 'colonic_covered_endbare',
            name: 'End Bare-Type',
            fullName: 'Niti-S Enteral Colonic Covered Stent [End Bare-Type]',
            imageFileName: 'colonic_covered_endbare.png',
            stentType: 'Covered',
            indication: 'Niti-S Enteral Colonic Covered Stent [End Bare-Type] is indicated for use in colon stricture caused by intrinsic and/or extrinsic malignant stricture.',
          },
        ],
      },
      {
        id: 'colonic-comvi',
        subTabName: 'ComVi Stent',
        models: [
          {
            id: 'colonic_comvi_bothbare',
            name: 'Both Bare-Type',
            fullName: 'ComVi Enteral Colonic Stent [Both Bare-Type]',
            imageFileName: 'colonic_comvi_bothbare.png',
            stentType: 'ComVi',
            indication: 'ComVi Enteral Colonic Stent [Both Bare-Type] is indicated for use in colon stricture caused by intrinsic and/or extrinsic malignant stricture.',
          },
        ],
      },
    ],
  },

  // 5. Drainage Stent
  {
    category: 'Drainage',
    displayName: 'Drainage Stent',
    headerTitle: 'Niti-S Drainage Stent (LAMS / BFMS)',
    subTabs: [
      {
        id: 'drainage-spaxus',
        subTabName: 'SPAXUS Stent',
        models: [
          {
            id: 'drainage_spaxus',
            name: 'SPAXUS',
            fullName: 'Niti-S SPAXUS™ Stent',
            imageFileName: 'drainage_spaxus.png',
            stentType: 'LAMS',
            indication: 'Niti-S SPAXUS™ Stent is indicated for transgastric or transduodenal drainage of a pancreatic pseudocyst or a walled off necrosis or a gallbladder or the biliary tract.',
          },
        ],
      },
      {
        id: 'drainage-hot-spaxus',
        subTabName: 'Hot SPAXUS Stent',
        models: [
          {
            id: 'drainage_hot_spaxus',
            name: 'Hot SPAXUS',
            fullName: 'Niti-S Hot SPAXUS™ Stent',
            imageFileName: 'drainage_hot_spaxus.png',
            stentType: 'LAMS',
            indication: 'Niti-S Hot SPAXUS™ Stent is indicated for transgastric or transduodenal drainage of a pancreatic pseudocyst or a walled off necrosis or a gallbladder or the biliary tract.',
          },
        ],
      },
      {
        id: 'drainage-nagi',
        subTabName: 'Nagi Stent',
        models: [
          {
            id: 'drainage_nagi',
            name: 'Nagi',
            fullName: 'Niti-S Nagi™ Stent',
            imageFileName: 'drainage_nagi.png',
            stentType: 'BFMS',
            indication: 'Niti-S Nagi™ Stent is indicated for drainage of a pancreatic pseudocyst through a transgastric or transduodenal approach.',
          },
        ],
      },
    ],
  },
];
