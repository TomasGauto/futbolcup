# BALANCE.md — por qué ninguna decisión es dominante

Regla de oro n°2 del diseño: si una opción siempre es la mejor, está mal balanceada. Acá está la contra de cada gran decisión.

## Doctrina del bienio
Elegir 2 ejes abarata 25% esa categoría y **encarece 15% todo lo demás**. Cambiar de doctrina entre bienios cuesta −12 de identidad del club (la identidad amortigua el humor de la hinchada). Mantener el rumbo da +6. → No hay doctrina "correcta": hay coherencia o oportunismo, ambos con precio.

## Mercado de pases
- **Pagar la cláusula / sobreofertar**: el fee se amortiza en el P&L durante todo el contrato (`fee/años` por temporada). Es la línea que funde a los clubes reales: comprás hoy, pagás FFP mañana.
- **Cuotas**: solo 40% al contado, pero el 60% queda como deuda con interés y te persigue 3 años.
- **Fichar del "exterior"**: más barato y siempre disponible, pero el potencial informado depende de tu scouting: con red floja, el fichaje fantasma existe (potencial inflado hasta +7).
- **Vender a la figura**: caja inmediata enorme, −8 moral de plantel, y si es ídolo −18 humor y −6 lealtad de hinchada para siempre.
- **Cláusulas de rescisión**: alta = renovaciones 15% más caras; baja o sin cláusula = invita ofertas de la IA (que te puede comprar jugadores si no los blindás).

## Plantilla
- **Prometer titularidad** para convencer en una renovación barata → si después no juega, moral −18 y pide salida. Las promesas son deuda.
- **Renovar viejo ídolo caro** vs. **dejarlo ir libre**: lo primero infla la masa salarial (>75% de ingresos = alerta y espiral), lo segundo enfurece a la gente.
- **Promover 5 pibes de golpe**: gratis y la hinchada lo ama, pero el once pierde química y overall real; el evento de la joya tiene 25% de salir mal.

## Estadio e infraestructura
- **Ampliar**: 1–2 temporadas con aforo al 80% (recaudás menos mientras pagás la obra). El retorno llega recién si la demanda acompaña (prestigio + humor + precios).
- **Estadio nuevo**: 420M y 4 temporadas de obra. Transforma el club o lo hunde en deuda por una década. Deliberadamente la decisión más pesada del juego.
- **No pagar mantenimiento**: gratis hoy; acumula `maintenanceDebt`, baja calidad (−asistencia) y no se arregla sola.
- **Financiar con deuda**: no toca la caja, pero la tasa depende del rating crediticio, y el interés sale del P&L todos los años.

## Comercial
- **Sponsor de apuestas**: paga ~55% más. −8 humor al firmar y la hinchada no lo olvida. La plata fácil tiene tribuna en contra.
- **Subir precios**: elasticidad 0.45 — +20% de precio ≈ −9% de asistencia y −4 humor. Maximizar ingreso por butaca enfría la popular que sostiene los malos años.
- **Gira de pretemporada**: ingreso inmediato alto, plantel arranca con −12 fitness → más lesiones tempranas (el riesgo de lesión escala con la fatiga).
- **Vender TV adelantada**: caja hoy, devolvés 125% en 3 años. Hipoteca explícita.

## Deuda
Tasa atada al rating (AAA 3% → CCC 16%). El rating cae con apalancamiento y caja negativa → espiral: cuanto más la necesitás, más cara es. FFP: 3 temporadas de pérdidas acumuladas activan sanciones escalonadas que terminan en prohibición de fichar.

## Cuerpo técnico
- **DT estrella (88)**: 30M+ que no van a plantel; su ventaja en partido es real pero acotada (coach pesa ±4% en λ).
- **Cambiar filosofía**: −1% de forma toda la temporada + moral −4. La táctica correcta contra el meta de tu liga vale hasta +8%, pero la adaptación se paga por adelantado.

## Momentos (decisiones de riesgo)
Toda opción "gratis" tiene costo diferido (moral, humor, jugador resentido) y toda opción riesgosa declara su probabilidad. Ejemplos calibrados: pedir el doble por la figura (30% éxito), apurar la recuperación de una lesión (50% de recaída con secuela permanente), titularizar a la joya (75/25).

## IA rival y mundo
Los 245+ clubes IA juegan con la misma economía (en Leyenda: +8% presupuesto, documentado). Mecenas aparecen (2%/año por club) y también crisis (1.5%): el mapa de poder cambia — validado: ≥4 campeones distintos y ≥3 clubes cambian de estrato en 30 años sin intervención del jugador.

## Validación numérica (npm run validate)
| Métrica | Objetivo | Resultado |
|---|---|---|
| 30 temporadas simuladas | < 20 s | ~5 s |
| Goles por partido | 2.5–3.0 | 2.65 |
| Victoria local | 42–48% | 43.0% |
| Puntos del campeón (liga 20) | 78–92 | 80.2 |
| Puntos del último | 20–30 | 21.1 |
| Campeones distintos | ≥ 4 | 6 |
| Cambios de estrato | ≥ 3 | 66 |
| Crisis financieras (30 años) | ≥ 3 | 47 |
| NaN / valores imposibles | 0 | 0 |
