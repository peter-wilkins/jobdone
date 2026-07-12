export const shinyArtShopV1 = Object.freeze({
  id: 'shiny_art_shop:v1',
  currency: 'GBP',
  basePrices: {
    embossed_metal_picture: { A5: 40, A4: 80 },
    layered_card_artwork: { A5: 25, A4: 50 },
  },
  materialModifiers: {
    aluminium: 0,
    copper_effect: 10,
    brass_effect: 10,
    brushed_steel_effect: 10,
    white_card: 0,
    black_core_card: 5,
    coloured_core_card: 5,
    kraft_card: 0,
  },
  finishModifiers: {
    natural: { A5: 0, A4: 0 },
    painted: { A5: 10, A4: 15 },
    framed: { A5: 15, A4: 25 },
  },
  deadlineMultipliers: {
    standard: 1,
    rush_3_5_days: 1.25,
    next_day: 1.75,
  },
  autoReviewTriggers: {
    orderNotesPresent: true,
    nextDay: true,
  },
  paymentPolicy: {
    fullUpfrontBelow: 50,
    depositPercent: 20,
  },
});

