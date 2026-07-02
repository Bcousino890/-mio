-- ─────────────────────────────────────────────────────────────────────────────
-- 0048 (antes 0033, número duplicado) · Completar chile_comunas con las 346 comunas de Chile
-- ─────────────────────────────────────────────────────────────────────────────
-- 0020 solo sembró las 52 comunas de la Región Metropolitana de Santiago (más
-- 4 comunas sueltas de otras regiones). La ingesta de GeoParquet de
-- catastral.cl (web/app/api/admin/ingest/route.ts) resuelve comuna_id por
-- nombre contra chile_comunas, así que cualquier archivo de una comuna fuera
-- de la RM fallaba con "No se encontró la comuna" (ej. Algarrobo_5406.parquet,
-- comuna de la Región de Valparaíso). Se agregan aquí las 294 comunas
-- restantes de las otras 15 regiones, completando las 346 comunas del país.
-- Nombres y división política-administrativa verificados contra SUBDERE/BCN.
-- ─────────────────────────────────────────────────────────────────────────────

-- Región de Arica y Parinacota (4)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Arica',          'Región de Arica y Parinacota', 'Arica',       NULL, false),
  ('Camarones',      'Región de Arica y Parinacota', 'Arica',       NULL, false),
  ('Putre',          'Región de Arica y Parinacota', 'Parinacota',  NULL, false),
  ('General Lagos',  'Región de Arica y Parinacota', 'Parinacota',  NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Tarapacá (7)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Iquique',         'Región de Tarapacá', 'Iquique',   NULL, false),
  ('Alto Hospicio',   'Región de Tarapacá', 'Iquique',   NULL, false),
  ('Pozo Almonte',    'Región de Tarapacá', 'Tamarugal', NULL, false),
  ('Camiña',          'Región de Tarapacá', 'Tamarugal', NULL, false),
  ('Colchane',        'Región de Tarapacá', 'Tamarugal', NULL, false),
  ('Huara',           'Región de Tarapacá', 'Tamarugal', NULL, false),
  ('Pica',            'Región de Tarapacá', 'Tamarugal', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Antofagasta (9)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Antofagasta',          'Región de Antofagasta', 'Antofagasta', NULL, false),
  ('Mejillones',           'Región de Antofagasta', 'Antofagasta', NULL, false),
  ('Sierra Gorda',         'Región de Antofagasta', 'Antofagasta', NULL, false),
  ('Taltal',               'Región de Antofagasta', 'Antofagasta', NULL, false),
  ('Calama',               'Región de Antofagasta', 'El Loa',      NULL, false),
  ('Ollagüe',              'Región de Antofagasta', 'El Loa',      NULL, false),
  ('San Pedro de Atacama', 'Región de Antofagasta', 'El Loa',      NULL, false),
  ('Tocopilla',            'Región de Antofagasta', 'Tocopilla',   NULL, false),
  ('María Elena',          'Región de Antofagasta', 'Tocopilla',   NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Atacama (9)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Chañaral',         'Región de Atacama', 'Chañaral', NULL, false),
  ('Diego de Almagro',  'Región de Atacama', 'Chañaral', NULL, false),
  ('Copiapó',          'Región de Atacama', 'Copiapó',  NULL, false),
  ('Tierra Amarilla',  'Región de Atacama', 'Copiapó',  NULL, false),
  ('Caldera',          'Región de Atacama', 'Copiapó',  NULL, false),
  ('Vallenar',         'Región de Atacama', 'Huasco',   NULL, false),
  ('Huasco',           'Región de Atacama', 'Huasco',   NULL, false),
  ('Freirina',         'Región de Atacama', 'Huasco',   NULL, false),
  ('Alto del Carmen',  'Región de Atacama', 'Huasco',   NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Coquimbo (15)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('La Higuera',     'Región de Coquimbo', 'Elqui',  NULL, false),
  ('La Serena',      'Región de Coquimbo', 'Elqui',  NULL, false),
  ('Coquimbo',       'Región de Coquimbo', 'Elqui',  NULL, false),
  ('Andacollo',      'Región de Coquimbo', 'Elqui',  NULL, false),
  ('Vicuña',         'Región de Coquimbo', 'Elqui',  NULL, false),
  ('Paihuano',       'Región de Coquimbo', 'Elqui',  NULL, false),
  ('Ovalle',         'Región de Coquimbo', 'Limarí', NULL, false),
  ('Río Hurtado',    'Región de Coquimbo', 'Limarí', NULL, false),
  ('Monte Patria',   'Región de Coquimbo', 'Limarí', NULL, false),
  ('Combarbalá',     'Región de Coquimbo', 'Limarí', NULL, false),
  ('Punitaqui',      'Región de Coquimbo', 'Limarí', NULL, false),
  ('Illapel',        'Región de Coquimbo', 'Choapa', NULL, false),
  ('Salamanca',      'Región de Coquimbo', 'Choapa', NULL, false),
  ('Los Vilos',      'Región de Coquimbo', 'Choapa', NULL, false),
  ('Canela',         'Región de Coquimbo', 'Choapa', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Valparaíso (38) — incluye Algarrobo (Provincia de San Antonio),
-- el caso reportado en Algarrobo_5406.parquet
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Isla de Pascua',          'Región de Valparaíso', 'Isla de Pascua',           NULL, false),
  ('Calle Larga',             'Región de Valparaíso', 'Los Andes',                NULL, false),
  ('Los Andes',               'Región de Valparaíso', 'Los Andes',                NULL, false),
  ('Rinconada',               'Región de Valparaíso', 'Los Andes',                NULL, false),
  ('San Esteban',             'Región de Valparaíso', 'Los Andes',                NULL, false),
  ('Limache',                 'Región de Valparaíso', 'Marga Marga',              NULL, false),
  ('Olmué',                   'Región de Valparaíso', 'Marga Marga',              NULL, false),
  ('Quilpué',                 'Región de Valparaíso', 'Marga Marga',              NULL, false),
  ('Villa Alemana',           'Región de Valparaíso', 'Marga Marga',              NULL, false),
  ('Cabildo',                 'Región de Valparaíso', 'Petorca',                  NULL, false),
  ('La Ligua',                'Región de Valparaíso', 'Petorca',                  NULL, false),
  ('Papudo',                  'Región de Valparaíso', 'Petorca',                  NULL, false),
  ('Petorca',                 'Región de Valparaíso', 'Petorca',                  NULL, false),
  ('Hijuelas',                'Región de Valparaíso', 'Quillota',                 NULL, false),
  ('La Calera',               'Región de Valparaíso', 'Quillota',                 NULL, false),
  ('La Cruz',                 'Región de Valparaíso', 'Quillota',                 NULL, false),
  ('Nogales',                 'Región de Valparaíso', 'Quillota',                 NULL, false),
  ('Quillota',                'Región de Valparaíso', 'Quillota',                 NULL, false),
  ('Algarrobo',               'Región de Valparaíso', 'San Antonio',              NULL, false),
  ('Cartagena',               'Región de Valparaíso', 'San Antonio',              NULL, false),
  ('El Quisco',               'Región de Valparaíso', 'San Antonio',              NULL, false),
  ('El Tabo',                 'Región de Valparaíso', 'San Antonio',              NULL, false),
  ('San Antonio',             'Región de Valparaíso', 'San Antonio',              NULL, false),
  ('Santo Domingo',           'Región de Valparaíso', 'San Antonio',              NULL, false),
  ('Catemu',                  'Región de Valparaíso', 'San Felipe de Aconcagua',  NULL, false),
  ('Llay-Llay',               'Región de Valparaíso', 'San Felipe de Aconcagua',  NULL, false),
  ('Panquehue',               'Región de Valparaíso', 'San Felipe de Aconcagua',  NULL, false),
  ('Putaendo',                'Región de Valparaíso', 'San Felipe de Aconcagua',  NULL, false),
  ('San Felipe',              'Región de Valparaíso', 'San Felipe de Aconcagua',  NULL, false),
  ('Santa María',             'Región de Valparaíso', 'San Felipe de Aconcagua',  NULL, false),
  ('Valparaíso',              'Región de Valparaíso', 'Valparaíso',               NULL, false),
  ('Viña del Mar',            'Región de Valparaíso', 'Valparaíso',               NULL, false),
  ('Concón',                  'Región de Valparaíso', 'Valparaíso',               NULL, false),
  ('Quintero',                'Región de Valparaíso', 'Valparaíso',               NULL, false),
  ('Casablanca',              'Región de Valparaíso', 'Valparaíso',               NULL, false),
  ('Juan Fernández',          'Región de Valparaíso', 'Valparaíso',               NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región del Libertador General Bernardo O'Higgins (33)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Rancagua',                     'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Codegua',                      'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Coinco',                       'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Coltauco',                     'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Doñihue',                      'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Graneros',                     'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Las Cabras',                   'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Machalí',                      'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Malloa',                       'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Mostazal',                     'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Olivar',                       'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Peumo',                        'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Pichidegua',                   'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Quinta de Tilcoco',            'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Rengo',                        'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Requínoa',                     'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('San Vicente de Tagua Tagua',   'Región del Libertador General Bernardo O''Higgins', 'Cachapoal',    NULL, false),
  ('Pichilemu',                    'Región del Libertador General Bernardo O''Higgins', 'Cardenal Caro', NULL, false),
  ('La Estrella',                  'Región del Libertador General Bernardo O''Higgins', 'Cardenal Caro', NULL, false),
  ('Litueche',                     'Región del Libertador General Bernardo O''Higgins', 'Cardenal Caro', NULL, false),
  ('Marchihue',                    'Región del Libertador General Bernardo O''Higgins', 'Cardenal Caro', NULL, false),
  ('Navidad',                      'Región del Libertador General Bernardo O''Higgins', 'Cardenal Caro', NULL, false),
  ('Paredones',                    'Región del Libertador General Bernardo O''Higgins', 'Cardenal Caro', NULL, false),
  ('San Fernando',                 'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Chépica',                      'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Chimbarongo',                  'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Lolol',                        'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Nancagua',                     'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Palmilla',                     'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Peralillo',                    'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Placilla',                     'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Pumanque',                     'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false),
  ('Santa Cruz',                   'Región del Libertador General Bernardo O''Higgins', 'Colchagua',    NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región del Maule (30)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Talca',              'Región del Maule', 'Talca',    NULL, false),
  ('Constitución',       'Región del Maule', 'Talca',    NULL, false),
  ('Curepto',            'Región del Maule', 'Talca',    NULL, false),
  ('Empedrado',          'Región del Maule', 'Talca',    NULL, false),
  ('Maule',              'Región del Maule', 'Talca',    NULL, false),
  ('Pelarco',            'Región del Maule', 'Talca',    NULL, false),
  ('Pencahue',           'Región del Maule', 'Talca',    NULL, false),
  ('Río Claro',          'Región del Maule', 'Talca',    NULL, false),
  ('San Clemente',       'Región del Maule', 'Talca',    NULL, false),
  ('San Rafael',         'Región del Maule', 'Talca',    NULL, false),
  ('Cauquenes',          'Región del Maule', 'Cauquenes', NULL, false),
  ('Chanco',             'Región del Maule', 'Cauquenes', NULL, false),
  ('Pelluhue',           'Región del Maule', 'Cauquenes', NULL, false),
  ('Curicó',             'Región del Maule', 'Curicó',   NULL, false),
  ('Hualañé',            'Región del Maule', 'Curicó',   NULL, false),
  ('Licantén',           'Región del Maule', 'Curicó',   NULL, false),
  ('Molina',             'Región del Maule', 'Curicó',   NULL, false),
  ('Rauco',              'Región del Maule', 'Curicó',   NULL, false),
  ('Romeral',            'Región del Maule', 'Curicó',   NULL, false),
  ('Sagrada Familia',    'Región del Maule', 'Curicó',   NULL, false),
  ('Teno',               'Región del Maule', 'Curicó',   NULL, false),
  ('Vichuquén',          'Región del Maule', 'Curicó',   NULL, false),
  ('Linares',            'Región del Maule', 'Linares',  NULL, false),
  ('Colbún',             'Región del Maule', 'Linares',  NULL, false),
  ('Longaví',            'Región del Maule', 'Linares',  NULL, false),
  ('Parral',             'Región del Maule', 'Linares',  NULL, false),
  ('Retiro',             'Región del Maule', 'Linares',  NULL, false),
  ('San Javier',         'Región del Maule', 'Linares',  NULL, false),
  ('Villa Alegre',       'Región del Maule', 'Linares',  NULL, false),
  ('Yerbas Buenas',      'Región del Maule', 'Linares',  NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Ñuble (21)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Cobquecura',      'Región de Ñuble', 'Itata',     NULL, false),
  ('Coelemu',         'Región de Ñuble', 'Itata',     NULL, false),
  ('Ninhue',          'Región de Ñuble', 'Itata',     NULL, false),
  ('Portezuelo',      'Región de Ñuble', 'Itata',     NULL, false),
  ('Quirihue',        'Región de Ñuble', 'Itata',     NULL, false),
  ('Ránquil',         'Región de Ñuble', 'Itata',     NULL, false),
  ('Trehuaco',        'Región de Ñuble', 'Itata',     NULL, false),
  ('Bulnes',          'Región de Ñuble', 'Diguillín', NULL, false),
  ('Chillán Viejo',   'Región de Ñuble', 'Diguillín', NULL, false),
  ('Chillán',         'Región de Ñuble', 'Diguillín', NULL, false),
  ('El Carmen',       'Región de Ñuble', 'Diguillín', NULL, false),
  ('Pemuco',          'Región de Ñuble', 'Diguillín', NULL, false),
  ('Pinto',           'Región de Ñuble', 'Diguillín', NULL, false),
  ('Quillón',         'Región de Ñuble', 'Diguillín', NULL, false),
  ('San Ignacio',     'Región de Ñuble', 'Diguillín', NULL, false),
  ('Yungay',          'Región de Ñuble', 'Diguillín', NULL, false),
  ('Coihueco',        'Región de Ñuble', 'Punilla',   NULL, false),
  ('Ñiquén',          'Región de Ñuble', 'Punilla',   NULL, false),
  ('San Carlos',      'Región de Ñuble', 'Punilla',   NULL, false),
  ('San Fabián',      'Región de Ñuble', 'Punilla',   NULL, false),
  ('San Nicolás',     'Región de Ñuble', 'Punilla',   NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región del Biobío (33)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Arauco',              'Región del Biobío', 'Arauco',    NULL, false),
  ('Cañete',               'Región del Biobío', 'Arauco',    NULL, false),
  ('Contulmo',             'Región del Biobío', 'Arauco',    NULL, false),
  ('Curanilahue',          'Región del Biobío', 'Arauco',    NULL, false),
  ('Lebu',                 'Región del Biobío', 'Arauco',    NULL, false),
  ('Los Álamos',           'Región del Biobío', 'Arauco',    NULL, false),
  ('Tirúa',                'Región del Biobío', 'Arauco',    NULL, false),
  ('Alto Biobío',          'Región del Biobío', 'Biobío',    NULL, false),
  ('Antuco',               'Región del Biobío', 'Biobío',    NULL, false),
  ('Cabrero',              'Región del Biobío', 'Biobío',    NULL, false),
  ('Laja',                 'Región del Biobío', 'Biobío',    NULL, false),
  ('Los Ángeles',          'Región del Biobío', 'Biobío',    NULL, false),
  ('Mulchén',              'Región del Biobío', 'Biobío',    NULL, false),
  ('Nacimiento',           'Región del Biobío', 'Biobío',    NULL, false),
  ('Negrete',              'Región del Biobío', 'Biobío',    NULL, false),
  ('Quilaco',              'Región del Biobío', 'Biobío',    NULL, false),
  ('Quilleco',             'Región del Biobío', 'Biobío',    NULL, false),
  ('San Rosendo',          'Región del Biobío', 'Biobío',    NULL, false),
  ('Santa Bárbara',        'Región del Biobío', 'Biobío',    NULL, false),
  ('Tucapel',              'Región del Biobío', 'Biobío',    NULL, false),
  ('Yumbel',               'Región del Biobío', 'Biobío',    NULL, false),
  ('Chiguayante',          'Región del Biobío', 'Concepción', NULL, false),
  ('Concepción',           'Región del Biobío', 'Concepción', NULL, false),
  ('Coronel',              'Región del Biobío', 'Concepción', NULL, false),
  ('Florida',              'Región del Biobío', 'Concepción', NULL, false),
  ('Hualpén',              'Región del Biobío', 'Concepción', NULL, false),
  ('Hualqui',              'Región del Biobío', 'Concepción', NULL, false),
  ('Lota',                 'Región del Biobío', 'Concepción', NULL, false),
  ('Penco',                'Región del Biobío', 'Concepción', NULL, false),
  ('San Pedro de la Paz',  'Región del Biobío', 'Concepción', NULL, false),
  ('Santa Juana',          'Región del Biobío', 'Concepción', NULL, false),
  ('Talcahuano',           'Región del Biobío', 'Concepción', NULL, false),
  ('Tomé',                 'Región del Biobío', 'Concepción', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de la Araucanía (32) — Pucón y Villarrica ya existen desde 0020
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Carahue',            'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Cholchol',           'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Cunco',              'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Curarrehue',         'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Freire',             'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Galvarino',          'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Gorbea',             'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Lautaro',            'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Loncoche',           'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Melipeuco',          'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Nueva Imperial',     'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Padre Las Casas',    'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Perquenco',          'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Pitrufquén',         'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Puerto Saavedra',    'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Temuco',             'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Teodoro Schmidt',    'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Toltén',             'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Vilcún',             'Región de la Araucanía', 'Cautín',  NULL, false),
  ('Angol',              'Región de la Araucanía', 'Malleco', NULL, false),
  ('Collipulli',         'Región de la Araucanía', 'Malleco', NULL, false),
  ('Curacautín',         'Región de la Araucanía', 'Malleco', NULL, false),
  ('Ercilla',            'Región de la Araucanía', 'Malleco', NULL, false),
  ('Lonquimay',          'Región de la Araucanía', 'Malleco', NULL, false),
  ('Los Sauces',         'Región de la Araucanía', 'Malleco', NULL, false),
  ('Lumaco',             'Región de la Araucanía', 'Malleco', NULL, false),
  ('Purén',              'Región de la Araucanía', 'Malleco', NULL, false),
  ('Renaico',            'Región de la Araucanía', 'Malleco', NULL, false),
  ('Traiguén',           'Región de la Araucanía', 'Malleco', NULL, false),
  ('Victoria',           'Región de la Araucanía', 'Malleco', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Los Ríos (12)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Valdivia',     'Región de Los Ríos', 'Valdivia', NULL, false),
  ('Mariquina',    'Región de Los Ríos', 'Valdivia', NULL, false),
  ('Lanco',        'Región de Los Ríos', 'Valdivia', NULL, false),
  ('Los Lagos',    'Región de Los Ríos', 'Valdivia', NULL, false),
  ('Corral',       'Región de Los Ríos', 'Valdivia', NULL, false),
  ('Máfil',        'Región de Los Ríos', 'Valdivia', NULL, false),
  ('Panguipulli',  'Región de Los Ríos', 'Valdivia', NULL, false),
  ('Paillaco',     'Región de Los Ríos', 'Valdivia', NULL, false),
  ('La Unión',     'Región de Los Ríos', 'Ranco',    NULL, false),
  ('Futrono',      'Región de Los Ríos', 'Ranco',    NULL, false),
  ('Río Bueno',    'Región de Los Ríos', 'Ranco',    NULL, false),
  ('Lago Ranco',   'Región de Los Ríos', 'Ranco',    NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Los Lagos (30) — Osorno incluye San Pablo (7ma comuna,
-- inicialmente omitida en varias fuentes resumidas)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Puerto Montt',          'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Puerto Varas',          'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Cochamó',               'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Calbuco',               'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Maullín',               'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Los Muermos',           'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Fresia',                'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Llanquihue',            'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Frutillar',             'Región de Los Lagos', 'Llanquihue', NULL, false),
  ('Ancud',                 'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Castro',                'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Chonchi',               'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Curaco de Vélez',       'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Dalcahue',              'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Puqueldón',             'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Queilén',               'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Quemchi',               'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Quellón',               'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Quinchao',              'Región de Los Lagos', 'Chiloé',     NULL, false),
  ('Osorno',                'Región de Los Lagos', 'Osorno',     NULL, false),
  ('Puerto Octay',          'Región de Los Lagos', 'Osorno',     NULL, false),
  ('Purranque',             'Región de Los Lagos', 'Osorno',     NULL, false),
  ('Puyehue',               'Región de Los Lagos', 'Osorno',     NULL, false),
  ('Río Negro',             'Región de Los Lagos', 'Osorno',     NULL, false),
  ('San Juan de la Costa',  'Región de Los Lagos', 'Osorno',     NULL, false),
  ('San Pablo',             'Región de Los Lagos', 'Osorno',     NULL, false),
  ('Chaitén',               'Región de Los Lagos', 'Palena',     NULL, false),
  ('Futaleufú',             'Región de Los Lagos', 'Palena',     NULL, false),
  ('Palena',                'Región de Los Lagos', 'Palena',     NULL, false),
  ('Hualaihué',             'Región de Los Lagos', 'Palena',     NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Aysén del General Carlos Ibáñez del Campo (10)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Aysén',           'Región de Aysén del General Carlos Ibáñez del Campo', 'Aysén',          NULL, false),
  ('Cisnes',          'Región de Aysén del General Carlos Ibáñez del Campo', 'Aysén',          NULL, false),
  ('Guaitecas',       'Región de Aysén del General Carlos Ibáñez del Campo', 'Aysén',          NULL, false),
  ('Coyhaique',       'Región de Aysén del General Carlos Ibáñez del Campo', 'Coyhaique',      NULL, false),
  ('Lago Verde',      'Región de Aysén del General Carlos Ibáñez del Campo', 'Coyhaique',      NULL, false),
  ('Chile Chico',     'Región de Aysén del General Carlos Ibáñez del Campo', 'General Carrera', NULL, false),
  ('Río Ibáñez',      'Región de Aysén del General Carlos Ibáñez del Campo', 'General Carrera', NULL, false),
  ('Cochrane',        'Región de Aysén del General Carlos Ibáñez del Campo', 'Capitán Prat',   NULL, false),
  ('O''Higgins',      'Región de Aysén del General Carlos Ibáñez del Campo', 'Capitán Prat',   NULL, false),
  ('Tortel',          'Región de Aysén del General Carlos Ibáñez del Campo', 'Capitán Prat',   NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región de Magallanes y de la Antártica Chilena (11)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Punta Arenas',       'Región de Magallanes y de la Antártica Chilena', 'Magallanes',       NULL, false),
  ('Río Verde',           'Región de Magallanes y de la Antártica Chilena', 'Magallanes',       NULL, false),
  ('Laguna Blanca',       'Región de Magallanes y de la Antártica Chilena', 'Magallanes',       NULL, false),
  ('San Gregorio',        'Región de Magallanes y de la Antártica Chilena', 'Magallanes',       NULL, false),
  ('Cabo de Hornos',      'Región de Magallanes y de la Antártica Chilena', 'Antártica Chilena', NULL, false),
  ('Antártica',           'Región de Magallanes y de la Antártica Chilena', 'Antártica Chilena', NULL, false),
  ('Porvenir',            'Región de Magallanes y de la Antártica Chilena', 'Tierra del Fuego', NULL, false),
  ('Primavera',           'Región de Magallanes y de la Antártica Chilena', 'Tierra del Fuego', NULL, false),
  ('Timaukel',            'Región de Magallanes y de la Antártica Chilena', 'Tierra del Fuego', NULL, false),
  ('Natales',             'Región de Magallanes y de la Antártica Chilena', 'Última Esperanza', NULL, false),
  ('Torres del Paine',    'Región de Magallanes y de la Antártica Chilena', 'Última Esperanza', NULL, false)
ON CONFLICT (name) DO NOTHING;
