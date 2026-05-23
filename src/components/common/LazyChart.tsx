import React from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

let registered = false;

const ensureChartRegistered = () => {
  if (registered) return;
  ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
  );
  registered = true;
};

interface LazyChartProps {
  type: "bar" | "line";
  data: any;
  options?: any;
  plugins?: any[];
}

const LazyChart: React.FC<LazyChartProps> = ({
  type,
  data,
  options,
  plugins,
}) => {
  ensureChartRegistered();
  return type === "line" ? (
    <Line data={data} options={options} plugins={plugins} />
  ) : (
    <Bar data={data} options={options} plugins={plugins} />
  );
};

export default LazyChart;
