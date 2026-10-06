import mosaicItems from "../data/mosaic-items.json";

export type Photo = (typeof mosaicItems)[number];

const imageOrigin = import.meta.env.PUBLIC_R2_IMAGE_ORIGIN?.replace(/\/$/, "");
if (!imageOrigin) throw new Error("[photos] PUBLIC_R2_IMAGE_ORIGIN is required");

export function bucketUrl(key: string): string {
  return `${imageOrigin}/${key}`;
}

export const imageUrl = bucketUrl;

const byId = new Map(mosaicItems.map((item) => [item.id, item]));

export function photoById(id: string): Photo {
  const item = byId.get(id);
  if (!item) throw new Error(`[photos] unknown photo id "${id}" (see src/data/mosaic-items.json)`);
  return item;
}

export const allPhotos: Photo[] = mosaicItems;

export function photoVariants(item: Photo) {
  return {
    ...item,
    src: bucketUrl(item.src),
    thumb: bucketUrl(item.src),
    srcset: "",
    aspect: Number((item.width / item.height).toFixed(4)),
  };
}

export type PhotoVariants = Awaited<ReturnType<typeof photoVariants>>;
