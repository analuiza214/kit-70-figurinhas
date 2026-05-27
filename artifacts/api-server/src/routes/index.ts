import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pixRouter from "./pix";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pixRouter);

export default router;
