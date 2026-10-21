import type { Quote } from "../../lib/quotes";
import type { Person, Task } from "../../lib/tasks";

const normalize = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

/** Links only unambiguous facts already present in the selected workspace. */
export function linkVoiceTask(
  task: Task,
  transcript: string,
  people: Person[],
  quotes: Quote[],
): Task {
  const personMatches = people.filter(
    (person) => normalize(person.name) === normalize(task.person),
  );
  if (personMatches.length !== 1) return task;
  const person = personMatches[0];
  const linked = { ...task, personId: person.id, person: person.name };
  const candidateQuotes = quotes.filter(
    (quote) => quote.customerId === person.id,
  );
  const context = normalize(`${task.title} ${task.notes} ${transcript}`);
  const matchingQuotes = candidateQuotes.filter(
    (quote) =>
      context.includes(normalize(quote.serviceDescription)) ||
      (candidateQuotes.length === 1 && /\b(?:quote|estimate)\b/.test(context)),
  );
  return matchingQuotes.length === 1
    ? { ...linked, quoteId: matchingQuotes[0].id }
    : linked;
}
