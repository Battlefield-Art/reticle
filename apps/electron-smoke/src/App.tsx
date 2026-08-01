import { useEffect, useState } from 'react';

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

/** The preload's contextBridge surface. Every call here is a main-process round trip, not HTTP. */
interface DesktopApi {
  loadTodos: () => Promise<Todo[]>;
  addTodo: (title: string) => Promise<Todo>;
  archiveTodo: (id: number) => Promise<void>;
}

function api(): DesktopApi {
  return (window as unknown as { api: DesktopApi }).api;
}

export function App(): React.ReactElement {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('loading…');

  useEffect(() => {
    void api()
      .loadTodos()
      .then((loaded) => {
        setTodos(loaded);
        setStatus(`${String(loaded.length)} todos`);
      });
  }, []);

  const add = (): void => {
    void api()
      .addTodo(draft)
      .then((todo) => {
        setTodos((current) => [...current, todo]);
        setDraft('');
        setStatus('added');
      })
      .catch(() => setStatus('could not add'));
  };

  /**
   * The planted false green. The IPC call ALWAYS rejects, but this handler updates the list and the
   * status line first and swallows the error — so the screen reads "archived" and a screenshot, a DOM
   * assertion, and a human glance all agree the feature works. Only the IPC record disagrees:
   *   reticle_network → ipc://api.archiveTodo  ok:false  "archive is not implemented in the backend"
   */
  const archive = (id: number): void => {
    setTodos((current) => current.filter((todo) => todo.id !== id));
    setStatus('archived');
    void api()
      .archiveTodo(id)
      .catch(() => {
        /* swallowed on purpose — this is the bug Reticle should catch */
      });
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 560 }}>
      <h1>Electron todos</h1>
      <p data-testid="status">{status}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="New todo"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What needs doing?"
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={add}>Add</button>
      </div>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id} style={{ margin: '8px 0' }}>
            {todo.title}
            <button onClick={() => archive(todo.id)} style={{ marginLeft: 12 }}>
              Archive
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
