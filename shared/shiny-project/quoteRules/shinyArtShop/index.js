import { shinyArtShopV1 } from './v1.js';

export const shinyArtShopQuoteRules = Object.freeze({
  latest: shinyArtShopV1,
  byId: Object.freeze({
    [shinyArtShopV1.id]: shinyArtShopV1,
  }),
});

