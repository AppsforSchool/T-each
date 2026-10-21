import { LIMITS } from '../../shared/limits'

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))), type, quality)
	)
}

/**
 * アップロード前に、画像を端末側で縮小・圧縮する（長辺 LIMITS.imageMaxLongSide px、JPEG）。
 * GIFだけは、動きを保つため、そのまま返す。サイズが上限を超える場合は、例外を投げる。
 */
export async function prepareImage(file: File): Promise<File> {
	if (file.type === 'image/gif') {
		if (file.size > LIMITS.imageMaxBytes) throw new Error('GIFのサイズが大きすぎます（5MBまで）')
		return file
	}

	const bitmap = await createImageBitmap(file) // 向き（EXIF）は、ブラウザが反映する
	const scale = Math.min(1, LIMITS.imageMaxLongSide / Math.max(bitmap.width, bitmap.height))
	const w = Math.max(1, Math.round(bitmap.width * scale))
	const h = Math.max(1, Math.round(bitmap.height * scale))

	const canvas = document.createElement('canvas')
	canvas.width = w
	canvas.height = h
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('画像を変換できませんでした')
	ctx.fillStyle = '#ffffff' // 透過のPNGが、黒くならないように
	ctx.fillRect(0, 0, w, h)
	ctx.drawImage(bitmap, 0, 0, w, h)
	bitmap.close()

	let quality = 0.85
	let blob = await toBlob(canvas, 'image/jpeg', quality)
	while (blob.size > LIMITS.imageMaxBytes && quality > 0.45) {
		quality -= 0.1
		blob = await toBlob(canvas, 'image/jpeg', quality)
	}
	if (blob.size > LIMITS.imageMaxBytes) throw new Error('画像のサイズが大きすぎます')
	return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}
