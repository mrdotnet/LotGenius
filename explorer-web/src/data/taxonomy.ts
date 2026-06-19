// Synthetic-but-representative taxonomy for the fixture corpus.
//
// Shaped after Steffes-style farm/industrial auction inventory so the graph and
// comps feel real, while containing ZERO real consignor/PII data. The generator
// (data/generate.ts) walks this taxonomy deterministically to emit ~hundreds of
// lots spanning multiple makes/models/categories/regions/auctions.

export interface ModelSpec {
  model: string;
  /** Plausible year span for this model; the generator samples within it. */
  yearMin: number;
  yearMax: number;
  /** Rough hammer-price center (USD); the generator jitters around it. */
  priceCenter: number;
}

export interface MakeSpec {
  make: string;
  models: ModelSpec[];
}

export interface CategorySpec {
  category: string;
  makes: MakeSpec[];
}

export const TAXONOMY: CategorySpec[] = [
  {
    category: "Combine",
    makes: [
      {
        make: "John Deere",
        models: [
          { model: "S680", yearMin: 2012, yearMax: 2018, priceCenter: 165000 },
          { model: "S780", yearMin: 2018, yearMax: 2023, priceCenter: 285000 },
          { model: "X9 1100", yearMin: 2021, yearMax: 2024, priceCenter: 575000 },
        ],
      },
      {
        make: "Case IH",
        models: [
          { model: "8240 Axial-Flow", yearMin: 2014, yearMax: 2019, priceCenter: 210000 },
          { model: "9250 Axial-Flow", yearMin: 2019, yearMax: 2023, priceCenter: 395000 },
        ],
      },
      {
        make: "New Holland",
        models: [
          { model: "CR9.90", yearMin: 2015, yearMax: 2021, priceCenter: 245000 },
        ],
      },
    ],
  },
  {
    category: "Tractor",
    makes: [
      {
        make: "John Deere",
        models: [
          { model: "8R 410", yearMin: 2018, yearMax: 2023, priceCenter: 315000 },
          { model: "6155R", yearMin: 2016, yearMax: 2022, priceCenter: 135000 },
        ],
      },
      {
        make: "Case IH",
        models: [
          { model: "Magnum 340", yearMin: 2015, yearMax: 2022, priceCenter: 225000 },
          { model: "Maxxum 150", yearMin: 2014, yearMax: 2021, priceCenter: 98000 },
        ],
      },
      {
        make: "Kubota",
        models: [
          { model: "M7-172", yearMin: 2017, yearMax: 2023, priceCenter: 112000 },
          { model: "L3901", yearMin: 2015, yearMax: 2022, priceCenter: 24000 },
        ],
      },
    ],
  },
  {
    category: "Skid Steer",
    makes: [
      {
        make: "Bobcat",
        models: [
          { model: "S650", yearMin: 2014, yearMax: 2021, priceCenter: 42000 },
          { model: "T770", yearMin: 2016, yearMax: 2022, priceCenter: 58000 },
        ],
      },
      {
        make: "Caterpillar",
        models: [
          { model: "262D", yearMin: 2015, yearMax: 2021, priceCenter: 46000 },
        ],
      },
    ],
  },
  {
    category: "Excavator",
    makes: [
      {
        make: "Caterpillar",
        models: [
          { model: "320", yearMin: 2014, yearMax: 2021, priceCenter: 165000 },
          { model: "336", yearMin: 2016, yearMax: 2022, priceCenter: 235000 },
        ],
      },
      {
        make: "Komatsu",
        models: [
          { model: "PC210", yearMin: 2015, yearMax: 2022, priceCenter: 148000 },
        ],
      },
    ],
  },
  {
    category: "Grain Cart",
    makes: [
      {
        make: "Brent",
        models: [
          { model: "1196", yearMin: 2013, yearMax: 2020, priceCenter: 58000 },
        ],
      },
      {
        make: "Kinze",
        models: [
          { model: "1051", yearMin: 2015, yearMax: 2022, priceCenter: 72000 },
        ],
      },
    ],
  },
  {
    category: "Planter",
    makes: [
      {
        make: "John Deere",
        models: [
          { model: "DB60", yearMin: 2014, yearMax: 2021, priceCenter: 128000 },
        ],
      },
      {
        make: "Kinze",
        models: [
          { model: "3600", yearMin: 2013, yearMax: 2020, priceCenter: 64000 },
        ],
      },
    ],
  },
];

/** Auction sale regions (US grain-belt flavored). */
export const REGIONS: string[] = [
  "North Dakota",
  "South Dakota",
  "Minnesota",
  "Iowa",
  "Nebraska",
  "Illinois",
];

/** Named auction events lots were sold through. */
export const AUCTIONS: string[] = [
  "Spring Farm Retirement",
  "Fall Equipment Consignment",
  "Online Timed Auction",
  "Annual Machinery Sale",
];
