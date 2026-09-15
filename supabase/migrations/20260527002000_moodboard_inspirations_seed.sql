-- ============================================================================
-- Seed initial des images d'inspiration sur les 9 moodboard_templates existants
-- Images via Unsplash (libres de droit, attribution non requise pour usage privé)
-- ============================================================================

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1577717903315-1691ae25ab3f?w=800&q=80',
  'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=800&q=80',
  'https://images.unsplash.com/photo-1604147495798-57beb5d6af73?w=800&q=80',
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80',
  'https://images.unsplash.com/photo-1615873968403-89e068629265?w=800&q=80',
  'https://images.unsplash.com/photo-1607873831066-49b22e7a8cf2?w=800&q=80'
] WHERE style = 'oriental_traditionnel';

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=800&q=80',
  'https://images.unsplash.com/photo-1618219740975-d40978bb7378?w=800&q=80',
  'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=800&q=80',
  'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80',
  'https://images.unsplash.com/photo-1567016376408-0226e4d0c1ea?w=800&q=80',
  'https://images.unsplash.com/photo-1615873968403-89e068629265?w=800&q=80'
] WHERE style = 'oriental_moderne';

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80',
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=800&q=80',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
  'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
  'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
  'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=800&q=80'
] WHERE style = 'contemporain_minimaliste';

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=80',
  'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=800&q=80',
  'https://images.unsplash.com/photo-1565182999561-18d7dc61c393?w=800&q=80',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
  'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=800&q=80',
  'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&q=80'
] WHERE style = 'scandinave';

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1564540583246-934409427776?w=800&q=80',
  'https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?w=800&q=80',
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800&q=80',
  'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=800&q=80',
  'https://images.unsplash.com/photo-1577984184741-c00e795c08d4?w=800&q=80',
  'https://images.unsplash.com/photo-1618220252344-8ec99ec624b1?w=800&q=80'
] WHERE style = 'industriel';

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1522444690501-9f0c5e9e1cc7?w=800&q=80',
  'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=800&q=80',
  'https://images.unsplash.com/photo-1567225557594-88d73e55f2cb?w=800&q=80',
  'https://images.unsplash.com/photo-1611048267451-e6ed903d4a38?w=800&q=80',
  'https://images.unsplash.com/photo-1616137148650-4aa14651e02d?w=800&q=80',
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=800&q=80'
] WHERE style = 'boheme';

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80',
  'https://images.unsplash.com/photo-1620626011761-996317b8d101?w=800&q=80',
  'https://images.unsplash.com/photo-1604147495798-57beb5d6af73?w=800&q=80',
  'https://images.unsplash.com/photo-1612965607446-25e1332775ae?w=800&q=80',
  'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=800&q=80',
  'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80'
] WHERE style = 'luxe_marocain';

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1551516594-56cb78394645?w=800&q=80',
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=800&q=80',
  'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=800&q=80',
  'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
  'https://images.unsplash.com/photo-1542401886-65d6c61db217?w=800&q=80',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80'
] WHERE style = 'tropical';

UPDATE moodboard_templates SET inspirations_urls = ARRAY[
  'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=800&q=80',
  'https://images.unsplash.com/photo-1618219944342-824e40a13285?w=800&q=80',
  'https://images.unsplash.com/photo-1615529182904-14819c35db37?w=800&q=80',
  'https://images.unsplash.com/photo-1615529182904-14819c35db37?w=800&q=80',
  'https://images.unsplash.com/photo-1633505650417-e9f6f88e5e9c?w=800&q=80',
  'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80'
] WHERE style = 'art_deco';
