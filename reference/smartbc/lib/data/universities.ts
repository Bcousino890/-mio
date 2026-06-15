// Catálogo de universidades / escuelas de Madrid con sus sedes.
// Usado por el componente "Distancia al campus" en la ficha pública de
// propiedad. Las coordenadas son aproximaciones manuales del centro del
// edificio principal de cada sede (precisión ~50-200m). Suficiente para
// el cálculo de tiempo aproximado por haversine; quien necesite exactitud
// puede abrir la ruta en Google Maps con el botón de la propia tarjeta.
//
// Para añadir/editar sedes: edita este archivo y haz PR. Si en el futuro
// hace falta CRUD desde admin, mueve a una tabla `university_campuses` y
// actualiza `lib/distance/index.ts`.

export type Campus = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
};

export type University = {
  id: string;
  name: string;
  shortName?: string;
  campuses: Campus[];
};

export const UNIVERSITIES: University[] = [
  {
    id: "ie",
    name: "IE University / IE Business School",
    shortName: "IE",
    campuses: [
      {
        id: "ie-tower",
        label: "IE Tower",
        address: "Paseo de la Castellana 259E, 28046 Madrid",
        lat: 40.4756,
        lng: -3.6893,
      },
      {
        id: "ie-maria-molina",
        label: "IE María de Molina",
        address: "C/ María de Molina 31, 28006 Madrid",
        lat: 40.4346,
        lng: -3.6822,
      },
    ],
  },
  {
    id: "eae",
    name: "EAE Business School Madrid",
    shortName: "EAE",
    campuses: [
      {
        id: "eae-joaquin-costa",
        label: "Campus Joaquín Costa",
        address: "C/ Joaquín Costa 41, 28002 Madrid",
        lat: 40.4424,
        lng: -3.6883,
      },
      {
        id: "eae-principe-vergara",
        label: "Campus Príncipe de Vergara",
        address: "C/ Príncipe de Vergara 156, 28002 Madrid",
        lat: 40.4395,
        lng: -3.6798,
      },
    ],
  },
  {
    id: "esic",
    name: "ESIC / ESIC University",
    shortName: "ESIC",
    campuses: [
      {
        id: "esic-pozuelo",
        label: "ESIC Pozuelo",
        address: "Av. de Juan XXIII 12, 28224 Pozuelo de Alarcón",
        lat: 40.4348,
        lng: -3.8170,
      },
      {
        id: "esic-university",
        label: "ESIC University (Valdenigriales)",
        address: "Av. de Valdenigriales s/n, 28223 Pozuelo de Alarcón",
        lat: 40.4358,
        lng: -3.8254,
      },
    ],
  },
  {
    id: "nebrija",
    name: "Universidad Nebrija",
    shortName: "Nebrija",
    campuses: [
      {
        id: "nebrija-princesa",
        label: "Madrid-Princesa",
        address: "C/ Santa Cruz de Marcenado 27-31, 28015 Madrid",
        lat: 40.4297,
        lng: -3.7113,
      },
      {
        id: "nebrija-arturo-soria",
        label: "Arturo Soria",
        address: "C/ Asura 90, 28043 Madrid",
        lat: 40.4513,
        lng: -3.6428,
      },
      {
        id: "nebrija-la-berzosa",
        label: "La Berzosa",
        address: "C/ Hostal s/n, 28248 Hoyo de Manzanares",
        lat: 40.6256,
        lng: -3.9133,
      },
      {
        id: "nebrija-san-francisco-sales",
        label: "San Francisco de Sales",
        address: "Paseo de San Francisco de Sales, Madrid",
        lat: 40.4374,
        lng: -3.7159,
      },
      {
        id: "nebrija-joaquin-maria-lopez",
        label: "Joaquín María López",
        address: "C/ Joaquín María López 62, 28015 Madrid",
        lat: 40.4347,
        lng: -3.7177,
      },
    ],
  },
  {
    id: "uem",
    name: "Universidad Europea de Madrid",
    shortName: "UEM",
    campuses: [
      {
        id: "uem-villaviciosa",
        label: "Villaviciosa de Odón",
        address: "C/ Tajo s/n, Urb. El Bosque, 28670 Villaviciosa de Odón",
        lat: 40.3580,
        lng: -3.8978,
      },
      {
        id: "uem-alcobendas",
        label: "Alcobendas",
        address: "Avda. Fernando Alonso 8, 28108 Alcobendas",
        lat: 40.5483,
        lng: -3.6483,
      },
      {
        id: "uem-creative",
        label: "Creative Campus",
        address: "C/ María de Molina 39, 28006 Madrid",
        lat: 40.4350,
        lng: -3.6809,
      },
      {
        id: "uem-odontologica",
        label: "Clínica Odontológica",
        address: "Paseo Santa María de la Cabeza 92, 28045 Madrid",
        lat: 40.3960,
        lng: -3.6976,
      },
      {
        id: "uem-policlinica",
        label: "Policlínica Universitaria",
        address: "Plaza Francisco Morano s/n, 28005 Madrid",
        lat: 40.4118,
        lng: -3.7115,
      },
    ],
  },
  {
    id: "ucm",
    name: "Universidad Complutense de Madrid",
    shortName: "UCM",
    campuses: [
      {
        id: "ucm-moncloa",
        label: "Ciudad Universitaria / Moncloa",
        address: "Avda. de Séneca 2, 28040 Madrid",
        lat: 40.4458,
        lng: -3.7286,
      },
      {
        id: "ucm-somosaguas",
        label: "Campus de Somosaguas",
        address: "Ctra. de Húmera s/n, 28223 Pozuelo de Alarcón",
        lat: 40.4253,
        lng: -3.7872,
      },
      {
        id: "ucm-comercio-turismo",
        label: "Comercio y Turismo",
        address: "Avda. de Filipinas 3, 28003 Madrid",
        lat: 40.4408,
        lng: -3.7090,
      },
    ],
  },
  {
    id: "uc3m",
    name: "Universidad Carlos III de Madrid",
    shortName: "UC3M",
    campuses: [
      {
        id: "uc3m-getafe",
        label: "Getafe",
        address: "C/ Madrid 126, 28903 Getafe",
        lat: 40.3091,
        lng: -3.7264,
      },
      {
        id: "uc3m-leganes",
        label: "Leganés",
        address: "Av. Universidad 30, 28911 Leganés",
        lat: 40.3309,
        lng: -3.7651,
      },
      {
        id: "uc3m-colmenarejo",
        label: "Colmenarejo",
        address: "Av. Gregorio Peces-Barba Martínez 22, 28270 Colmenarejo",
        lat: 40.5683,
        lng: -3.9742,
      },
      {
        id: "uc3m-puerta-toledo",
        label: "Madrid Puerta de Toledo",
        address: "Ronda de Toledo 1, 28005 Madrid",
        lat: 40.4081,
        lng: -3.7117,
      },
    ],
  },
  {
    id: "uam",
    name: "Universidad Autónoma de Madrid",
    shortName: "UAM",
    campuses: [
      {
        id: "uam-cantoblanco",
        label: "Cantoblanco",
        address: "Ciudad Universitaria de Cantoblanco, 28049 Madrid",
        lat: 40.5455,
        lng: -3.6916,
      },
      {
        id: "uam-medicina",
        label: "Medicina",
        address: "C/ Arzobispo Morcillo 4, 28029 Madrid",
        lat: 40.4756,
        lng: -3.6877,
      },
    ],
  },
  {
    id: "comillas",
    name: "Universidad Pontificia Comillas (ICADE/ICAI)",
    shortName: "Comillas",
    campuses: [
      {
        id: "comillas-aguilera-23",
        label: "Alberto Aguilera 23",
        address: "C/ Alberto Aguilera 23, 28015 Madrid",
        lat: 40.4282,
        lng: -3.7124,
      },
      {
        id: "comillas-aguilera-25",
        label: "Alberto Aguilera 25",
        address: "C/ Alberto Aguilera 25, 28015 Madrid",
        lat: 40.4284,
        lng: -3.7126,
      },
      {
        id: "comillas-cantoblanco",
        label: "Cantoblanco",
        address: "C/ Universidad Comillas 3-5, 28049 Madrid",
        lat: 40.5468,
        lng: -3.6856,
      },
      {
        id: "comillas-chamartin",
        label: "Chamartín",
        address: "C/ Mateo Inurria 25, 28036 Madrid",
        lat: 40.4651,
        lng: -3.6863,
      },
      {
        id: "comillas-habana",
        label: "Paseo de la Habana",
        address: "Pº de la Habana 70 bis, 28016 Madrid",
        lat: 40.4554,
        lng: -3.6815,
      },
      {
        id: "comillas-ciempozuelos",
        label: "Ciempozuelos",
        address: "Avda. San Juan de Dios 1, 28350 Ciempozuelos",
        lat: 40.1612,
        lng: -3.6235,
      },
    ],
  },
  {
    id: "urjc",
    name: "Universidad Rey Juan Carlos",
    shortName: "URJC",
    campuses: [
      {
        id: "urjc-vicalvaro",
        label: "Vicálvaro / Madrid",
        address: "Paseo de los Artilleros s/n, 28032 Madrid",
        lat: 40.4011,
        lng: -3.6107,
      },
      {
        id: "urjc-quintana",
        label: "Madrid-Quintana",
        address: "C/ Quintana 21, 28008 Madrid",
        lat: 40.4308,
        lng: -3.7223,
      },
      {
        id: "urjc-manuel-becerra",
        label: "Madrid-Manuel Becerra",
        address: "Plaza Manuel Becerra 14, 28028 Madrid",
        lat: 40.4290,
        lng: -3.6750,
      },
      {
        id: "urjc-mostoles",
        label: "Móstoles",
        address: "C/ Tulipán s/n, 28933 Móstoles",
        lat: 40.3338,
        lng: -3.8722,
      },
      {
        id: "urjc-alcorcon",
        label: "Alcorcón",
        address: "Avda. de Atenas s/n, 28922 Alcorcón",
        lat: 40.3535,
        lng: -3.8367,
      },
      {
        id: "urjc-fuenlabrada",
        label: "Fuenlabrada",
        address: "Camino del Molino s/n, 28943 Fuenlabrada",
        lat: 40.2845,
        lng: -3.8124,
      },
      {
        id: "urjc-aranjuez",
        label: "Aranjuez",
        address: "C/ Capitán Angosto Gómez Castrillón 91, 28300 Aranjuez",
        lat: 40.0322,
        lng: -3.6088,
      },
    ],
  },
  {
    id: "upm",
    name: "Universidad Politécnica de Madrid",
    shortName: "UPM",
    campuses: [
      {
        id: "upm-rectorado",
        label: "Rectorado / Ciudad Universitaria",
        address: "C/ Ramiro de Maeztu 7, 28040 Madrid",
        lat: 40.4476,
        lng: -3.7283,
      },
      {
        id: "upm-sur",
        label: "Campus Sur (Vallecas)",
        address: "C/ Alan Turing s/n, 28031 Madrid",
        lat: 40.3863,
        lng: -3.6296,
      },
      {
        id: "upm-montegancedo",
        label: "Montegancedo (Boadilla / Pozuelo)",
        address: "Campus de Montegancedo, 28223 Pozuelo de Alarcón",
        lat: 40.4042,
        lng: -3.8332,
      },
    ],
  },
  {
    id: "uah",
    name: "Universidad de Alcalá",
    shortName: "UAH",
    campuses: [
      {
        id: "uah-historico",
        label: "Rectorado / Campus Histórico",
        address: "Plaza San Diego s/n, 28801 Alcalá de Henares",
        lat: 40.4831,
        lng: -3.3666,
      },
      {
        id: "uah-cientifico",
        label: "Campus Científico-Tecnológico",
        address: "Ctra. Madrid-Barcelona km 33,600, 28805 Alcalá de Henares",
        lat: 40.5108,
        lng: -3.3475,
      },
      {
        id: "uah-torrejon",
        label: "Torrejón",
        address: "Avda. de la Constitución 236, 28850 Torrejón de Ardoz",
        lat: 40.4567,
        lng: -3.4824,
      },
    ],
  },
  {
    id: "ucjc",
    name: "Universidad Camilo José Cela",
    shortName: "UCJC",
    campuses: [
      {
        id: "ucjc-villafranca",
        label: "Villafranca",
        address: "C/ Castillo de Alarcón 49, Urb. Villafranca del Castillo, 28692 Villanueva de la Cañada",
        lat: 40.4581,
        lng: -3.9119,
      },
      {
        id: "ucjc-castellana",
        label: "Campus Castellana",
        address: "C/ Juan Hurtado de Mendoza 4, 28036 Madrid",
        lat: 40.4630,
        lng: -3.6900,
      },
    ],
  },
  {
    id: "ceu",
    name: "Universidad CEU San Pablo",
    shortName: "CEU",
    campuses: [
      {
        id: "ceu-moncloa",
        label: "Moncloa",
        address: "C/ Julián Romea 23, 28003 Madrid",
        lat: 40.4458,
        lng: -3.7080,
      },
      {
        id: "ceu-monteprincipe",
        label: "Montepríncipe",
        address: "Urbanización Montepríncipe, 28925 Alcorcón",
        lat: 40.3782,
        lng: -3.8068,
      },
    ],
  },
  {
    id: "uax",
    name: "Universidad Alfonso X el Sabio",
    shortName: "UAX",
    campuses: [
      {
        id: "uax-villanueva",
        label: "Villanueva de la Cañada",
        address: "Avda. de la Universidad 1, 28691 Villanueva de la Cañada",
        lat: 40.4441,
        lng: -3.9842,
      },
      {
        id: "uax-chamberi",
        label: "Madrid Chamberí",
        address: "C/ Arapiles 13, 28015 Madrid",
        lat: 40.4322,
        lng: -3.7079,
      },
    ],
  },
  {
    id: "ufv",
    name: "Universidad Francisco de Vitoria",
    shortName: "UFV",
    campuses: [
      {
        id: "ufv-principal",
        label: "Campus principal (Pozuelo-Majadahonda)",
        address: "Ctra. Pozuelo-Majadahonda km 1.800, 28223 Pozuelo de Alarcón",
        lat: 40.4421,
        lng: -3.8451,
      },
      {
        id: "ufv-orense",
        label: "Campus urbano UFV",
        address: "C/ Orense 69, Madrid",
        lat: 40.4569,
        lng: -3.6957,
      },
    ],
  },
  {
    id: "villanueva",
    name: "Universidad Villanueva",
    shortName: "Villanueva",
    campuses: [
      {
        id: "villanueva-mirasierra",
        label: "Mirasierra",
        address: "C/ Costa Brava 2 y 6, 28034 Madrid",
        lat: 40.4859,
        lng: -3.7079,
      },
      {
        id: "villanueva-pozuelo",
        label: "Pozuelo",
        address: "Av. Juan XXIII 7 bis, 28224 Pozuelo de Alarcón",
        lat: 40.4357,
        lng: -3.8160,
      },
      {
        id: "villanueva-zurbano",
        label: "Zurbano",
        address: "C/ Zurbano 73, 28010 Madrid",
        lat: 40.4339,
        lng: -3.6940,
      },
    ],
  },
  {
    id: "cunef",
    name: "CUNEF Universidad",
    shortName: "CUNEF",
    campuses: [
      {
        id: "cunef-almansa",
        label: "Almansa",
        address: "C/ Almansa 101, 28040 Madrid",
        lat: 40.4527,
        lng: -3.7165,
      },
      {
        id: "cunef-pirineos",
        label: "Pirineos",
        address: "C/ Pirineos 55, 28040 Madrid",
        lat: 40.4513,
        lng: -3.7202,
      },
      {
        id: "cunef-prieto-castro",
        label: "Centro Adscrito",
        address: "C/ Leonardo Prieto Castro 2, Ciudad Universitaria, 28040 Madrid",
        lat: 40.4503,
        lng: -3.7278,
      },
    ],
  },
  {
    id: "unie",
    name: "UNIE Universidad",
    shortName: "UNIE",
    campuses: [
      {
        id: "unie-castellana",
        label: "Castellana",
        address: "Avda. de Monforte de Lemos 28, Madrid",
        lat: 40.4761,
        lng: -3.7035,
      },
      {
        id: "unie-arapiles",
        label: "Arapiles",
        address: "C/ Arapiles 14, Madrid",
        lat: 40.4320,
        lng: -3.7077,
      },
      {
        id: "unie-tres-cantos",
        label: "Tres Cantos",
        address: "Avda. de España 4, Tres Cantos",
        lat: 40.6033,
        lng: -3.7104,
      },
    ],
  },
  {
    id: "udit",
    name: "UDIT — Universidad de Diseño, Innovación y Tecnología",
    shortName: "UDIT",
    campuses: [
      {
        id: "udit-alfonso-xiii",
        label: "Diseño e Industrias Creativas",
        address: "Av. de Alfonso XIII 97, Madrid",
        lat: 40.4644,
        lng: -3.6664,
      },
      {
        id: "udit-alcala",
        label: "Tecnología",
        address: "C/ Alcalá 506, Madrid",
        lat: 40.4263,
        lng: -3.6433,
      },
    ],
  },
  {
    id: "utad",
    name: "U-tad — Centro Universitario de Tecnología y Arte Digital",
    shortName: "U-tad",
    campuses: [
      {
        id: "utad-las-rozas",
        label: "Las Rozas",
        address: "C/ Playa de Liencres 2 bis, Parque Europa Empresarial, 28290 Las Rozas",
        lat: 40.5198,
        lng: -3.8762,
      },
      {
        id: "utad-alcala-253",
        label: "Madrid centro",
        address: "C/ Alcalá 253, 28027 Madrid",
        lat: 40.4321,
        lng: -3.6618,
      },
    ],
  },
  {
    id: "tai",
    name: "TAI — Escuela Universitaria de Artes",
    shortName: "TAI",
    campuses: [
      {
        id: "tai-recoletos",
        label: "Madrid",
        address: "C/ Recoletos 22, Madrid",
        lat: 40.4234,
        lng: -3.6915,
      },
    ],
  },
  {
    id: "cardenal-cisneros",
    name: "Centro Universitario Cardenal Cisneros",
    shortName: "Cardenal Cisneros",
    campuses: [
      {
        id: "cisneros-alcala",
        label: "Alcalá",
        address: "Avda. Jesuitas 34, 28806 Alcalá de Henares",
        lat: 40.4881,
        lng: -3.3582,
      },
    ],
  },
  {
    id: "unir",
    name: "UNIR — Universidad Internacional de La Rioja (sede Madrid)",
    shortName: "UNIR",
    campuses: [
      {
        id: "unir-pozuelo",
        label: "Sede Madrid / Pozuelo",
        address: "C/ García Martín 21, 28224 Pozuelo de Alarcón",
        lat: 40.4344,
        lng: -3.8183,
      },
    ],
  },
  {
    id: "isdi",
    name: "ISDI Madrid",
    shortName: "ISDI",
    campuses: [
      {
        id: "isdi-viriato",
        label: "Madrid",
        address: "C/ Viriato 20, 28010 Madrid",
        lat: 40.4365,
        lng: -3.7019,
      },
    ],
  },
];

/** Indexa todos los campus por su id, para lookup directo. */
export const CAMPUS_BY_ID: Record<string, { campus: Campus; university: University }> = (() => {
  const out: Record<string, { campus: Campus; university: University }> = {};
  for (const u of UNIVERSITIES) {
    for (const c of u.campuses) {
      out[c.id] = { campus: c, university: u };
    }
  }
  return out;
})();
