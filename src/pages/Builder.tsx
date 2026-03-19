import { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { StepsList } from '../components/StepsList';
import { FileExplorer } from '../components/FileExplorer';
import { TabView } from '../components/TabView';
import { CodeEditor } from '../components/codeEditor';
import { PreviewFrame } from '../components/PreviewFrame';
import { type Step, type FileItem, StepType } from '../types/index.js';
import axios from 'axios';
import { BACKEND_URL } from '../config.js';
import { parseXml } from '../steps.js';
import { useWebContainer } from '../hooks/useWebContainer';
import { Spinner } from '../components/Loader';
import { validateStepsFromParsed } from '../validation/validateSteps.js';
import { downloadProjectZip } from '../utils/exportZip.js';

import { ssePost } from '../utils/ssePost.js';
import { BoltStreamParser } from '../utils/BoltStreamParser.js';


type BuildStage =
  | "idle"
  | "template"
  | "chat"
  | "parsing"
  | "writing"
  | "installing"
  | "starting"
  | "ready"
  | "error";

type PendingWrite = {
  id: number;
  filePath: string;
  full: string;
  cursor: number;
};


export function Builder() {
  const location = useLocation();
  const { prompt } = location.state as { prompt: string };
  const [userPrompt, setPrompt] = useState("");
  const [llmMessages, setLlmMessages] = useState<{ role: "user" | "assistant", content: string; }[]>([]);
  const [loading, setLoading] = useState(false);
  const [templateSet, setTemplateSet] = useState(false);
  const webcontainer = useWebContainer();

  const [currentStep, setCurrentStep] = useState(1);
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  const [steps, setSteps] = useState<Step[]>([]);

  const [files, setFiles] = useState<FileItem[]>([]);

  const mountedRef = useRef(false);

  const [hydrated, setHydrated] = useState(false);
  const [hasCache, setHasCache] = useState(false);


  const [stage, setStage] = useState<BuildStage>("idle");
  const [stageMsg, setStageMsg] = useState("");

  const [activity, setActivity] = useState<string>("");
  const processingRef = useRef(false);

  //for streaming
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");

  const parserRef = useRef<BoltStreamParser>(new BoltStreamParser());

  const initStartdRef = useRef(false);

  const typingQueueRef = useRef<PendingWrite[]>([]);
  const typingTimerRef = useRef<number | null>(null)

  //generating different keys for different prompts
  const cacheKey = useMemo(
    () => `builder_cache:${prompt.trim().toLowerCase()}`,
    [prompt]
  );

  const safeParseXml = (text: string) => {
    try {
      return parseXml(text);
    } catch (e) {
      console.error("parseXml failed (likely truncated XML):", e);
      return [];
    }
  };

  //checking if cache is available....
  useEffect(() => {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      try {
        const cache = JSON.parse(raw);
        if (cache.files) setFiles(cache.files);
        if (cache.steps) setSteps(cache.steps);
        if (cache.llmMessages) setLlmMessages(cache.llmMessages);
        setHasCache(true);
        setTemplateSet(true);
        setStage("ready");
        setStageMsg("Preview Ready");
      } catch { }
    }
    setHydrated(true);
  }, [cacheKey]);

  //saveing the cache in local storage
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      cacheKey,
      JSON.stringify({ files, steps, llmMessages })
    );
  }, [files, cacheKey, steps, llmMessages, hydrated]);

  //applying web container 
  const createMountStructure = useMemo(() => {
    const build = (nodes: FileItem[]): Record<string, any> => {
      const out: Record<string, any> = {};
      for (const node of nodes) {
        if (node.type === "folder") {
          out[node.name] = { directory: build(node.children ?? []) };
        } else {
          out[node.name] = { file: { contents: node.content ?? "" } };
        }
      }
      return out;
    };
    return build(files);
  }, [files]);

  const ensureDir = async (absDir: string) => {
    try {
      await webcontainer!.fs.mkdir(absDir, { recursive: true });
    } catch (e) {
    }
  };


  const writeFileAtPath = async (pathFromStep: string, content: string) => {
    const absPath = pathFromStep.startsWith("/") ? pathFromStep : `/${pathFromStep}`;

    const lastSlash = absPath.lastIndexOf("/");

    const dir = lastSlash <= 0 ? "/" : absPath.slice(0, lastSlash);

    await ensureDir(dir);

    await webcontainer!.fs.writeFile(absPath, content ?? "");
  }


  useEffect(() => {
    if (!hydrated) return;
    if (!webcontainer) return;

    if (processingRef.current) return;

    const next = steps.find((s) => s.status === "pending");
    if (!next) return;

    processingRef.current = true;

    (async () => {
      try {
        if (!mountedRef.current) {
          mountedRef.current = true;
          await webcontainer.mount(createMountStructure);
        }

        //marke this one atep in-progressing...
        setActivity(
          next.type === StepType.CreateFile && next.path ? `Writing ${next.path}...` : `Running ${next.type}...`
        );

        setSteps((prev) =>
          prev.map((s) =>
            (s.id === next.id ? { ...s, status: "in-progress" } : s))
        );

        //aplying this one step in webcontainer
        if (next.type === StepType.CreateFile && next.path) {
          setFiles((prevFiles) => {
            const nextFiles: FileItem[] = structuredClone(prevFiles);

            const upsertFile = (path: string, content: string) => {
              const parts = path.split("/").filter(Boolean);
              let cursor = nextFiles;
              let currentPath = "";

              for (let i = 0; i < parts.length; i++) {
                const name = parts[i];
                currentPath += `/${name}`;
                const isLast = i === parts.length - 1;

                const existing = cursor.find((x) => x.path === currentPath);

                if (isLast) {
                  if (!existing) cursor.push({ name, type: "file", path: currentPath, content });
                  else if (existing.type === "file") existing.content = content;
                } else {
                  if (!existing) {
                    cursor.push({ name, type: "folder", path: currentPath, children: [] });
                  }
                  const folder = cursor.find((x) => x.path === currentPath);
                  if (!folder || folder.type !== "folder") return;
                  cursor = folder.children!;
                }
              }
            };

            upsertFile(next.path!, next.code ?? "");
            return nextFiles;
          });

          //writing file into web container
          await writeFileAtPath(next.path!, next.code ?? "");

        }

        // optional delay so loader is visible
        await new Promise((r) => setTimeout(r, 200));

        // 3) mark completed
        setSteps((prev) =>
          prev.map((s) => (s.id === next.id ? { ...s, status: "completed" } : s))
        );
      } catch (e) {
        console.error("Step apply failed: ", e);
      } finally {
        setActivity("");
        processingRef.current = false;
      }
    })();
  }, [hydrated, webcontainer, steps, createMountStructure]);


  const upsertFileTree = (tree: FileItem[], path: string, content: string) => {
    const nextFiles: FileItem[] = structuredClone(tree);

    const parts = path.split("/").filter(Boolean);
    let cursor = nextFiles;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      currentPath += `/${name}`;
      const isLast = i === parts.length - 1;

      const existing = cursor.find((x) => x.path === currentPath);

      if (isLast) {
        if (!existing) cursor.push({ name, type: "file", path: currentPath, content });
        else if (existing.type === "file") existing.content = content;
      } else {
        if (!existing) cursor.push({ name, type: "folder", path: currentPath, children: [] });
        const folder = cursor.find((x) => x.path === currentPath);
        if (!folder || folder.type !== "folder") return nextFiles;
        cursor = folder.children!;
      }
    }

    return nextFiles;
  };


  const startTypingEngine = () => {
  if (typingTimerRef.current) return;

  typingTimerRef.current = window.setInterval(async () => {
    const q = typingQueueRef.current;
    if (!q.length) {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      return;
    }

    const current = q[0];

    // reveal speed
    const CHARS_PER_TICK = 30; // tweak: 10-60
    current.cursor = Math.min(current.full.length, current.cursor + CHARS_PER_TICK);

    const visible = current.full.slice(0, current.cursor);

    // update file tree (UI typing)
    setFiles((prev) => upsertFileTree(prev, current.filePath, visible));

    // done typing this file
    if (current.cursor >= current.full.length) {
      // write FULL content to webcontainer (real FS)
      if (webcontainer) {
        await writeFileAtPath(current.filePath, current.full);
      }

      // mark step complete
      setSteps((prev) =>
        prev.map((s) => (s.id === current.id ? { ...s, status: "completed" } : s))
      );

      q.shift(); // remove finished file
    }
  }, 16); // ~60fps
};


  const runChatStreaming = async (
    messages: Array<{ role: "user" | "assistant", content: string }>,
    signal?: AbortSignal
  ) => {
    setStreaming(true);
    setStreamText("");

    parserRef.current = new BoltStreamParser();
    const parser = parserRef.current;

    let fullText = "";

    try {
      await ssePost(
        `${BACKEND_URL}/chat/stream`,
        { messages },
        (evt) => {
          if (signal?.aborted) return;

          if (evt.event === "token") {
            const token = evt.data.token ?? evt.data;
            if (!token) return;

            fullText += token;
            setStreamText((prev) => (prev + token).slice(-50_000));

            const actions = parser.pushToken(token);
            if (actions.length) {
              console.log("actionsFound", actions);
            }

            for (const a of actions) {
              if (a.kind !== "file") continue;
              console.log("[FILE ACTION RAW START]", a.filePath, JSON.stringify(a.content.slice(0, 80)));

              setSteps((prev) => {
                let maxId = prev.reduce((m, x) => Math.max(m, x.id), 0);
                const nextId = maxId + 1;

                typingQueueRef.current.push({
                  id: nextId,
                  filePath: a.filePath,
                  full: a.content,
                  cursor: 0,
                });

                startTypingEngine();

                return [
                  ...prev,
                  {
                    id: nextId,
                    type: StepType.CreateFile,
                    status: "in-progress",
                    title: `Create ${a.filePath}`,
                    description: `Generated ${a.filePath}`,
                    path: a.filePath,
                    code: a.content,
                  },
                ];
              });
            }
          }

          if (evt.event === "error") {
            console.error("stream error: ", evt.data.message);
            setStage("error");
            setStageMsg(evt.data?.message ?? "Streaming failed ❌");
          }

          if (evt.event === "done") {
            console.log('stream done!!')
          }
        },
        signal
      );
    } finally {
      setStreaming(false)
    }
    return fullText;
  };


  const runInit = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setStage("template");
      setStageMsg("Analyzing prompt & selecting template…");
      const response = await axios.post(`${BACKEND_URL}/template`, {
        prompt: prompt.trim(),
      }, { signal })

      if (signal?.aborted) return;

      setTemplateSet(true);
      const { prompts, uiPrompts } = response.data;

      const templateParsed = safeParseXml(uiPrompts[0]);
      const templateValidated = validateStepsFromParsed(templateParsed);

      const templateSteps: Step[] = templateValidated.map((x, i) => ({
        ...x,
        id: i + 1,
        status: "pending",
        title: x.type === StepType.CreateFile ? `Create ${x.path}` : x.type,
        description: x.type === StepType.CreateFile ? `Generated ${x.path}` : "",
      }))

      setSteps(templateSteps);

      setStage("chat");
      setStageMsg("Generaating steps");

      const msgs = [...prompts, prompt].map((content: string) => ({ role: "user" as const, content }));

      const assistantText = await runChatStreaming(msgs, signal);

      if (signal?.aborted) return

      setLlmMessages([
        ...msgs,
        { role: "assistant", content: assistantText },
      ]);

      setStage("ready");
      setStageMsg("Preview ready ✅");

    } catch (e) {
      if ((signal as any)?.aborted) return;
      console.error(e);
      setStage("error");
      setStageMsg("Build failed ❌");
    }
    finally {
      setLoading(false)
    }
  };


  useEffect(() => {
    initStartdRef.current = false;
  }, [prompt]);

  useEffect(() => {
    if (!hydrated) return;
    if (hasCache) {
      setTemplateSet(true);
      setStage("ready");
      setStageMsg("Loaded from cache ✅");
      return;
    };

    if (initStartdRef.current) return;
    initStartdRef.current = true;

    const controller = new AbortController();

    runInit(controller.signal).catch((e) => {
      if (controller.signal.aborted) return;
      console.error("Init failed: ", e);
    })

    return () => controller.abort();

  }, [hydrated, hasCache, prompt]);



  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <header className="bg-gray-800 border-b max-h-[15vh] border-gray-700 px-6 py-4">
        <div className='flex items-end justify-between'>
          <div>
            <h1 className="text-xl font-semibold text-gray-100">Website Builder</h1>
            <p className="text-sm text-gray-400 mt-1">Prompt: {prompt}</p>
          </div>
          <button
            className="bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded"
            onClick={() => downloadProjectZip(files, "project.zip")}
            disabled={!files.length}
          >
            Download ZIP file
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-4 gap-6 p-6">
          <div className="col-span-1 space-y-6 overflow-auto">
            <div>
              <div className="max-h-[75vh] overflow-y-scroll">
                {stage !== "ready" && (
                  <div className='text-sm text-gray-300 flex justify-center items-center'>
                    <div> <Spinner className='text-white mr-2' /></div>
                    {stageMsg}
                  </div>
                )}
                <StepsList
                  steps={steps}
                  currentStep={currentStep}
                  onStepClick={setCurrentStep}
                  activity={activity}
                />

                {/* ✅ Bolt-like typing panel */}
                {streaming && (
                  <div className="text-xs text-gray-400 mt-2 whitespace-pre-wrap max-h-40 overflow-auto border border-gray-700 rounded p-2">
                    {streamText || "Generating..."}
                  </div>
                )}
              </div>
              <div>
                <div className='flex'>
                  <br />
                  {stage == "ready" && !(loading || !templateSet) && <div className='flex'>
                    <input
                      value={userPrompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="w-full h-12 p-4 bg-gray-900 text-gray-100 border border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none placeholder-gray-500"
                    />
                    <button onClick={async () => {
                      const newMessage = {
                        role: "user" as "user",
                        content: userPrompt
                      };

                      setLoading(true);
                      const stepsResponse = await axios.post(`${BACKEND_URL}/chat`, {
                        messages: [...llmMessages, newMessage]
                      });
                      setLoading(false);

                      const chatParsed = safeParseXml(stepsResponse.data.reply);
                      const chatValidated = validateStepsFromParsed(chatParsed);

                      setLlmMessages(x => [...x, newMessage]);
                      setLlmMessages(x => [...x, {
                        role: "assistant",
                        content: stepsResponse.data.reply
                      }]);

                      setSteps((prev) => {
                        const maxId = prev.reduce((m, s) => Math.max(m, s.id), 0);

                        const newSteps: Step[] = chatValidated.map((x, i) => ({
                          ...x,
                          id: maxId + i + 1,
                          status: "pending",
                          title: x.type === StepType.CreateFile ? `Create ${x.path}` : x.type,
                          description: x.type === StepType.CreateFile ? `Generated ${x.path}` : "",
                        }))
                        return [...prev, ...newSteps]
                      })

                    }} className='bg-green-500 hover:bg-green-600 text-white px-7 py-1 rounded'>Send</button>
                  </div>}
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-1">
            <FileExplorer
              files={files}
              onFileSelect={setSelectedFile}
            />
          </div>
          <div className="col-span-2 bg-gray-900 rounded-lg shadow-lg p-4 h-[calc(100vh-8rem)]">
            <TabView activeTab={activeTab} onTabChange={setActiveTab} />
            <div className="h-[calc(100%-4rem)]">
              {activeTab === 'code' ? (
                <CodeEditor file={selectedFile} />
              ) : (
                <PreviewFrame webContainer={webcontainer!} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}