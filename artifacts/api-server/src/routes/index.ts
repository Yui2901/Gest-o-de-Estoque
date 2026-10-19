import { Router, type IRouter } from "express";
import healthRouter from "./health";
import productsRouter from "./products";
import ordersRouter from "./orders";
import authRouter from "./auth";
import warehousesRouter from "./warehouses";
import customersRouter from "./customers";
import suppliersRouter from "./suppliers";
import reportsRouter from "./reports";
import { requireAppUser } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireAppUser);
router.use(productsRouter);
router.use(ordersRouter);
router.use(warehousesRouter);
router.use(customersRouter);
router.use(suppliersRouter);
router.use(reportsRouter);

export default router;
