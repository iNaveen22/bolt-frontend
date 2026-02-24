import JSZip from "jszip";
import type { FileItem } from "../types";

export async function downloadProjectZip(files: FileItem[], zipName: "project.zip") {
    const zip = new JSZip();

    const add = (nodes: FileItem[], base = "") => {
        for (const node of nodes) {
            const full = base ? `${base}/${node.name}` : node.name;
            if(node.type === "folder"){
                add(node.children ?? [], full);
            } else {
                zip.file(full, node.content ?? "")
            }
        }
    };

    add(files);

    const blob = await zip.generateAsync({ type: "blob" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}