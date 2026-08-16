-- Два одинаковых названия тарифа в одной зоне админ на стойке не различит.
CREATE UNIQUE INDEX "Tariff_clubId_zoneId_name_key" ON "Tariff"("clubId", "zoneId", "name");
