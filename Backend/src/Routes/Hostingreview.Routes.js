import { Router } from 'express';
import { createReview, deleteReview, getAllReviews, getAllReviewsAdmin, getAvailableProviders, getReviewByIdAdmin, getReviewBySlug, previewProviderStats, refreshReviewStats, setPublished, updateReview } from '../Controllers/HostingReview.Controller.js';
import checkAuth, { adminChecker } from '../Middleware/authentication.Mw.js';



const router = Router();


// ---------- ADMIN (must be declared BEFORE the public /:slug route) ----------
router.get('/admin/providers',checkAuth, adminChecker, getAvailableProviders);
router.get('/admin/providers/:providerKey/stats',checkAuth, adminChecker,  previewProviderStats);
router.get('/admin/all',checkAuth, adminChecker,  getAllReviewsAdmin);
router.post('/admin/create',checkAuth, adminChecker,createReview);
router.get('/admin/:id',checkAuth, adminChecker,  getReviewByIdAdmin);
router.put('/admin/:id',checkAuth, adminChecker, updateReview);
router.post('/admin/:id/refresh-stats',checkAuth, adminChecker,refreshReviewStats);
router.patch('/admin/:id/publish',checkAuth, adminChecker,  setPublished);
router.delete('/admin/:id',checkAuth, adminChecker,  deleteReview);

// ---------- PUBLIC ----------
router.get('/', getAllReviews);
router.get('/:slug', getReviewBySlug);

export default router;

// In index.js / server.js:
//   import hostingReviewRouter from './routes/HostingReview.Routes.js';
//   app.use('/api/reviews', hostingReviewRouter);