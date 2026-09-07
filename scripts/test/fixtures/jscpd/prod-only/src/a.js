export function compute(value) {
  const payload01 = { alpha: value + 1, beta: value + 2, gamma: value + 3 };
  const payload02 = { alpha: value + 4, beta: value + 5, gamma: value + 6 };
  const payload03 = { alpha: value + 7, beta: value + 8, gamma: value + 9 };
  const series = [
    payload01.alpha + payload01.beta + payload01.gamma,
    payload02.alpha + payload02.beta + payload02.gamma,
    payload03.alpha + payload03.beta + payload03.gamma,
  ];
  const summary = {
    first: series[0] * 2,
    second: series[1] * 3,
    third: series[2] * 4,
    aggregate: series[0] + series[1] + series[2],
  };
  return summary.first + summary.second + summary.third + summary.aggregate;
}
