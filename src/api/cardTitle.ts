/**
 * A card's name (Danylo, 23.11.2026): a card with a picture needs none, and
 * shows its picture alone. Its name is then "", on every device and in the
 * backend's CONTRACT ("a card with only a picture is stored with title: ''").
 */

/**
 * What the site called a card left unnamed until 23.11.2026, in each language
 * it wrote it in, and the phone's English one: on a card with a picture each
 * reads as no name, and the next save stores "".
 */
export const OLD_UNNAMED: ReadonlySet<string> = new Set([
  "Untitled card",
  "بطاقة بلا عنوان",
  "Unbenannte Karte",
  "Tarjeta sin título",
  "Carte sans titre",
  "無題のカード",
  "Karta bez tytułu",
  "Cartão sem título",
  "Карточка без названия",
  "Başlıksız kart",
  "Картка без назви",
]);

/** Whether a card has a picture of its own to show: a kept photo or an address. */
export const hasPicture = (card: {
  imageUrl?: string | null;
  pictureId?: string | null;
}): boolean => (card.imageUrl ?? "") !== "" || (card.pictureId ?? "") !== "";

/** The name a card keeps: an old default on a card with a picture is none. */
export const cardTitleOf = (title: string, pictured: boolean): string =>
  pictured && OLD_UNNAMED.has(title.trim()) ? "" : title;
