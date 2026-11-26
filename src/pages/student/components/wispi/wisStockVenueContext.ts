import { createContext, useContext } from "react";
import {
  DOMESTIC_STOCK_VENUE,
  type StudentWisStockVenue,
} from "../../../../lib/studentWisStockVenue";

/** The surrounding market's venue. My Page and older screens stay domestic. */
export const WisStockVenueContext =
  createContext<StudentWisStockVenue>(DOMESTIC_STOCK_VENUE);
export const useWisStockVenue = () => useContext(WisStockVenueContext);
