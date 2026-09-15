export interface FunctionHelp {
  name: string;
  snippet: string;
  help: string;
  /** Aggregations and iterators only make sense in a measure. */
  measureOnly?: boolean;
}

/** The function reference shown beside the formula editor, grouped as in the compiler (bi/dax.js). */
export const FUNCTION_GROUPS: { label: string; functions: FunctionHelp[] }[] = [
  {
    label: 'Aggregation',
    functions: [
      { name: 'COUNTROWS', snippet: 'COUNTROWS(Table)', help: 'Counts the rows of the home table.', measureOnly: true },
      { name: 'SUM', snippet: 'SUM(Table[Column])', help: 'Adds a numeric column.', measureOnly: true },
      { name: 'AVERAGE', snippet: 'AVERAGE(Table[Column])', help: 'Averages a numeric column.', measureOnly: true },
      { name: 'MIN', snippet: 'MIN(Table[Column])', help: 'Smallest value.', measureOnly: true },
      { name: 'MAX', snippet: 'MAX(Table[Column])', help: 'Largest value.', measureOnly: true },
      { name: 'DISTINCTCOUNT', snippet: 'DISTINCTCOUNT(Table[Column])', help: 'Counts distinct values.', measureOnly: true },
      { name: 'COUNTBLANK', snippet: 'COUNTBLANK(Table[Column])', help: 'Counts blank values.', measureOnly: true },
    ],
  },
  {
    label: 'Iterators',
    functions: [
      { name: 'SUMX', snippet: 'SUMX(Table, Table[Column] * 2)', help: 'Works out the expression for each row, then adds the results.', measureOnly: true },
      { name: 'AVERAGEX', snippet: 'AVERAGEX(Table, Table[Column])', help: 'Averages a per-row expression.', measureOnly: true },
      { name: 'MINX', snippet: 'MINX(Table, Table[Column])', help: 'Smallest per-row result.', measureOnly: true },
      { name: 'MAXX', snippet: 'MAXX(Table, Table[Column])', help: 'Largest per-row result.', measureOnly: true },
      { name: 'COUNTX', snippet: 'COUNTX(Table, Table[Column])', help: 'Counts rows where the expression is not blank.', measureOnly: true },
    ],
  },
  {
    label: 'Logical',
    functions: [
      { name: 'IF', snippet: 'IF(condition, "Yes", "No")', help: 'One result when the condition is true, another when it is false.' },
      { name: 'SWITCH', snippet: 'SWITCH(TRUE(), condition, "A", "Otherwise")', help: 'The first matching branch. SWITCH(value, match, result, …) compares one value.' },
      { name: 'AND', snippet: 'AND(condition, condition)', help: 'True when both are true. Also written &&.' },
      { name: 'OR', snippet: 'OR(condition, condition)', help: 'True when either is true. Also written ||.' },
      { name: 'NOT', snippet: 'NOT(condition)', help: 'Reverses true and false.' },
      { name: 'ISBLANK', snippet: 'ISBLANK(value)', help: 'True when the value is blank.' },
      { name: 'BLANK', snippet: 'BLANK()', help: 'A blank value.' },
    ],
  },
  {
    label: 'Text',
    functions: [
      { name: '&', snippet: ' & ', help: 'Joins text: [Status] & " (" & [Count] & ")".' },
      { name: 'CONCATENATE', snippet: 'CONCATENATE(text, text)', help: 'Joins two pieces of text.' },
      { name: 'LEFT', snippet: 'LEFT(text, 3)', help: 'The first characters.' },
      { name: 'RIGHT', snippet: 'RIGHT(text, 3)', help: 'The last characters.' },
      { name: 'MID', snippet: 'MID(text, 2, 3)', help: 'Characters from a start position.' },
      { name: 'LEN', snippet: 'LEN(text)', help: 'Number of characters.' },
      { name: 'UPPER', snippet: 'UPPER(text)', help: 'Capital letters.' },
      { name: 'LOWER', snippet: 'LOWER(text)', help: 'Small letters.' },
      { name: 'TRIM', snippet: 'TRIM(text)', help: 'Removes spaces at the start and end.' },
      { name: 'FORMAT', snippet: 'FORMAT(value, "0.0%")', help: 'Number or date as text: "#,0.0", "0%", "dd MMM yyyy".' },
    ],
  },
  {
    label: 'Date',
    functions: [
      { name: 'TODAY', snippet: 'TODAY()', help: "Today's date (UTC)." },
      { name: 'NOW', snippet: 'NOW()', help: 'The current date and time (UTC).' },
      { name: 'DATE', snippet: 'DATE(2026, 1, 31)', help: 'A date from year, month and day.' },
      { name: 'YEAR', snippet: 'YEAR(date)', help: 'The year number.' },
      { name: 'MONTH', snippet: 'MONTH(date)', help: 'The month number, 1 to 12.' },
      { name: 'DAY', snippet: 'DAY(date)', help: 'The day of the month.' },
      { name: 'WEEKDAY', snippet: 'WEEKDAY(date, 2)', help: 'Day of the week; 2 means Monday = 1.' },
      { name: 'DATEDIFF', snippet: 'DATEDIFF(start, end, DAY)', help: 'Intervals between two dates: DAY, WEEK, MONTH, QUARTER, YEAR, HOUR, MINUTE, SECOND.' },
      { name: 'EOMONTH', snippet: 'EOMONTH(date, 0)', help: 'Last day of the month, months ahead or back.' },
    ],
  },
  {
    label: 'Math',
    functions: [{ name: 'DIVIDE', snippet: 'DIVIDE(numerator, denominator)', help: 'Division that returns blank instead of an error on zero.' }],
  },
];
