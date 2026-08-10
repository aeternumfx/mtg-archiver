import { Router } from 'express';
import { resolveImage } from '../services/images';

export const imagesRouter = Router();

imagesRouter.get('/:cardId/:size', async (req, res) => {
  const { cardId, size } = req.params;
  try {
    const img = await resolveImage(cardId, size);
    if (!img) return res.status(404).json({ error: 'Image not found' });
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(img.file);
  } catch {
    res.status(500).json({ error: 'Image proxy error' });
  }
});
