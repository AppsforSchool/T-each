// 画像の縦横のサイズを、ファイルの先頭部分から読み取る（ボードに、正しい比率で配置するため）。
// 対応：PNG / GIF / JPEG / WebP。読み取れなければ、既定のサイズを返す。

export type ImageInfo = { w: number; h: number; mime: string; animated: boolean }
const FALLBACK: ImageInfo = { w: 400, h: 300, mime: 'image/jpeg', animated: false }

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)

export function parseImageInfo(b: Uint8Array): ImageInfo | null {
	// PNG
	if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
		return { w: u32be(b, 16), h: u32be(b, 20), mime: 'image/png', animated: false }
	// GIF
	if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
		return { w: u16le(b, 6), h: u16le(b, 8), mime: 'image/gif', animated: true }
	// JPEG：SOF（フレーム情報）のマーカーを探す
	if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
		let o = 2
		while (o + 9 < b.length) {
			if (b[o] !== 0xff) {
				o++
				continue
			}
			const m = b[o + 1]
			if (m === 0xff) {
				o++
				continue
			}
			if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
				return { h: u16be(b, o + 5), w: u16be(b, o + 7), mime: 'image/jpeg', animated: false }
			if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) {
				o += 2 // 長さを持たないマーカー
				continue
			}
			o += 2 + u16be(b, o + 2)
		}
	}
	// WebP
	if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
		const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
		if (kind === 'VP8X')
			return { w: 1 + u24le(b, 24), h: 1 + u24le(b, 27), mime: 'image/webp', animated: (b[20] & 0x02) !== 0 }
		if (kind === 'VP8 ')
			return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff, mime: 'image/webp', animated: false }
		if (kind === 'VP8L') {
			const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
			return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, mime: 'image/webp', animated: false }
		}
	}
	return null
}

export async function fetchImageInfo(url: string): Promise<ImageInfo> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
		if (!res.ok) return FALLBACK
		const len = Number(res.headers.get('content-length') ?? 0)
		if (len > 12 * 1024 * 1024) return FALLBACK
		const info = parseImageInfo(new Uint8Array(await res.arrayBuffer()))
		return info && info.w > 0 && info.h > 0 ? info : FALLBACK
	} catch {
		return FALLBACK
	}
}
