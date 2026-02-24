import { WebContainer, type WebContainerProcess } from '@webcontainer/api';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from './Loader';

interface PreviewFrameProps {
  // files: any[];
  webContainer?: WebContainer;
}

export function PreviewFrame({ webContainer }: PreviewFrameProps) {
  const [url, setUrl] = useState("");
  const startedRef = useRef(false);
  const devProcessRef = useRef<WebContainerProcess | null>(null);

  useEffect(() => {
    if (!webContainer) return;
    if (startedRef.current) return;

    startedRef.current = true;

    let disposed = false;

    const onServerReady = (port: number, url: string) => {
      if (disposed) return;
      console.log("Dev server will be running on port:", port, "url: ", url);
      setUrl(url);
    };

    webContainer.on('server-ready', onServerReady);

    (async () => {
      try {
        let needsInstall = false;
        try {
          await webContainer.fs.readdir('node_modules');
        } catch {
          needsInstall = true;
        }

        if (needsInstall) {
          const installProcess = await webContainer.spawn('npm', ['install']);
          installProcess.output.pipeTo(
            new WritableStream({
              write(data) {
                console.log('[npm install]', data);
              },
            })
          );

          // ✅ IMPORTANT: wait for install to finish
          const installExitCode = await installProcess.exit;
          if (installExitCode !== 0) {
            console.error('npm install failed with code', installExitCode);
            return;
          }
        }

        // ✅ start dev (don't await exit; it won't exit)
        const devProcess = await webContainer.spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0']);
        devProcessRef.current = devProcess;

        devProcess.output.pipeTo(
          new WritableStream({
            write(data) {
              console.log('[npm dev]', data);
            },
          })
        );
      } catch (err) {
        console.log("Preview start error: ", err);
      }
    })();


    return () => {
      disposed = true;
    };
  }, [webContainer]);

  return (
    <div className="h-full flex items-center justify-center text-gray-400">
      {!url ? (
        <div className='text-sm text-gray-300 flex justify-center items-center'>
          <div> <Spinner className='text-white mr-2' /></div>
          <p >Loading...</p>
        </div>
      ) : (
        <iframe title='preview' width="100%" height="100%" src={url} style={{ border: "none" }} />
      )}
    </div>
  );
}