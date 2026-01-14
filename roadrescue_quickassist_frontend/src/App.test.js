import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders RoadRescue brand", () => {
  render(<App />);
  const brand = screen.getByText(/RoadRescue/i);
  expect(brand).toBeInTheDocument();
});
