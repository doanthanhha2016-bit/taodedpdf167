// src/components/PDFExamCreator.tsx — Wizard 5 bước + Drag-Drop Overlay Editor
import React, { useState, useRef, useCallback } from "react";
import { Exam, Question, ExamSection, ExamPointsConfig, SectionPointsConfig, QuestionSolutionRange } from "../types";
import PointsConfigEditor from "./PointsConfigEditor";
import { uploadPDFToGoogleDrive, DriveUploadResult } from "../services/googleDriveService";

// ─── Types ───────────────────────────────────────────────────────────────────
interface PDFExamConfig { title:string; timeLimit:number; mcCount:number; tfCount:number; saCount:number; writingCount:number; }
type MCAnswers={[n:number]:string}; type TFAnswers={[n:number]:string[]}; type SAAnswers={[n:number]:string}; type WritingAnswers={[n:number]:string};
type SolutionRanges={[n:number]:QuestionSolutionRange}; type SolutionMode="split"|"full"; type UploadStatus="idle"|"uploading"|"done"|"error";
type OverlayCtrlKind="mc_opt"|"tf_sub"|"sa_box"|"wr_box";
interface TxtItem{str:string;x:number;y:number;w:number;page:number;pw:number;ph:number;}
interface OverlayCtrl{id:string;kind:OverlayCtrlKind;qNum:number;letter?:string;page:number;xPct:number;yPct:number;widthPct?:number;heightPx?:number;}
interface PreviewPage{src:string;}

// ─── Detection ───────────────────────────────────────────────────────────────
function detectPdfOverlayControls(items:TxtItem[],mcCount:number,tfCount:number,saCount:number,wrCount:number):OverlayCtrl[]{
  const ctrls:OverlayCtrl[]=[];
  const sorted=[...items].sort((a,b)=>a.page!==b.page?a.page-b.page:Math.abs(a.y-b.y)>2?b.y-a.y:a.x-b.x);
  const norm=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
  const toPct=(it:TxtItem)=>({xPct:(it.x/it.pw)*100,yPct:((it.ph-it.y)/it.ph)*100});
  const si=(rx:RegExp)=>sorted.findIndex(it=>rx.test(norm(it.str).toUpperCase()));
  const ip2=si(/PHAN\s*(II|2)\b|DUNG\s*SAI/),ip3=si(/PHAN\s*(III|3)\b|TRA\s*LOI\s*NGAN/),ip4=si(/PHAN\s*(IV|4)\b|TU\s*LUAN/);
  const inSlice=(it:TxtItem,from:number,to:number)=>{const idx=sorted.indexOf(it);return(from<0||idx>from)&&(to<0||idx<to);};
  const sameLine=(a:TxtItem,b:TxtItem,tol=5)=>a.page===b.page&&Math.abs(a.y-b.y)<=tol;

  if(mcCount>0){
    const pool=sorted.filter(it=>/^([A-D])\s*[.|)|:]/i.test(norm(it.str))&&(ip2<0||sorted.indexOf(it)<ip2));
    const aAnchors=pool.filter(it=>/^A\s*[.|)|:]/i.test(norm(it.str))).slice(0,mcCount);
    aAnchors.forEach((aItem,qi)=>{
      const nA=aAnchors[qi+1];
      ["A","B","C","D"].forEach(letter=>{
        const pat=new RegExp(`^${letter}\\s*[.|)|:]`,"i");
        let found=letter==="A"?aItem:pool.find(o=>pat.test(norm(o.str))&&sameLine(o,aItem));
        if(!found)found=pool.find(o=>pat.test(norm(o.str))&&(o.page>aItem.page||(o.page===aItem.page&&o.y<aItem.y))&&(!nA||o.page<nA.page||(o.page===nA.page&&o.y>nA.y)));
        if(found)ctrls.push({id:`mc-${qi+1}-${letter}`,kind:"mc_opt",qNum:qi+1,letter,page:found.page,...toPct(found)});
      });
    });
  }

  if(tfCount>0){
    const tfEnd=ip3>=0?ip3:ip4;
    const tfRx=(l:string)=>new RegExp(`^${l}\\s*[)|.|:]`,"i");
    let aAnchors=sorted.filter(it=>tfRx("a").test(norm(it.str))&&inSlice(it,ip2,tfEnd)).slice(0,tfCount);
    if(aAnchors.length<tfCount&&ip2>=0){
      const lh=sorted.filter(it=>inSlice(it,ip2,tfEnd)).reduce<TxtItem[]>((acc,it)=>{if(!acc.some(x=>sameLine(x,it,6)))acc.push(it);return acc;},[]);
      for(const h of lh){if(aAnchors.length>=tfCount)break;if(!aAnchors.some(x=>sameLine(x,h,6)))aAnchors.push(h);}
    }
    aAnchors.slice(0,tfCount).forEach((aItem,qi)=>{
      const nA=aAnchors[qi+1];
      ["a","b","c","d"].forEach((letter,si2)=>{
        let found:TxtItem|undefined=si2===0?aItem:sorted.find(o=>tfRx(letter).test(norm(o.str))&&inSlice(o,ip2,tfEnd)&&(o.page>aItem.page||(o.page===aItem.page&&o.y<aItem.y+3))&&(!nA||o.page<nA.page||(o.page===nA.page&&o.y>nA.y)));
        if(!found)found={...aItem,y:aItem.y-18*si2};
        ctrls.push({id:`tf-${201+qi}-${letter}`,kind:"tf_sub",qNum:201+qi,letter,page:found.page,...toPct(found)});
      });
    });
  }

  const detectSection=(start:number,end:number,count:number,base:number,kind:OverlayCtrlKind)=>{
    if(count<=0||start<0)return;
    const qRx=/^C(A|Â)U\s*\d+\s*[.|)|:]/i;
    let heads=sorted.filter(it=>qRx.test(norm(it.str).toUpperCase())&&inSlice(it,start,end)).slice(0,count);
    if(heads.length<count){
      const lines=sorted.filter(it=>inSlice(it,start,end)).reduce<TxtItem[]>((acc,it)=>{if(!acc.some(x=>sameLine(x,it,6)))acc.push(it);return acc;},[]);
      const step=Math.max(1,Math.floor(lines.length/Math.max(1,count)));
      heads=Array.from({length:count},(_,i)=>lines[Math.min(i*step,lines.length-1)]).filter(Boolean);
    }
    heads.forEach((head,i)=>{
      const next=heads[i+1];
      const block=sorted.filter(it=>inSlice(it,start,end)&&(it.page>head.page||(it.page===head.page&&it.y<=head.y+2))&&(!next||it.page<next.page||(it.page===next.page&&it.y>next.y)));
      const last=block.sort((a,b)=>a.page!==b.page?b.page-a.page:a.y-b.y)[0]||head;
      ctrls.push({id:`${kind}-${base+i}`,kind,qNum:base+i,page:last.page,xPct:7,yPct:Math.min(94,((last.ph-last.y+16)/last.ph)*100),widthPct:kind==="sa_box"?56:86,heightPx:kind==="sa_box"?30:120});
    });
  };
  detectSection(ip3,ip4,saCount,301,"sa_box");
  detectSection(ip4,-1,wrCount,401,"wr_box");
  return ctrls;
}

// ─── Misc ────────────────────────────────────────────────────────────────────
const loadPdfJs=():Promise<any>=>new Promise((resolve,reject)=>{const w=window as any;if(w.pdfjsLib){resolve(w.pdfjsLib);return;}const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";s.onload=()=>{w.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";resolve(w.pdfjsLib);};s.onerror=()=>reject(new Error("Không thể tải pdf.js"));document.head.appendChild(s);});
const mcRange=(n:number)=>Array.from({length:n},(_,i)=>i+1);
const tfRange=(n:number)=>Array.from({length:n},(_,i)=>201+i);
const saRange=(n:number)=>Array.from({length:n},(_,i)=>301+i);
const writingRange=(n:number)=>Array.from({length:n},(_,i)=>401+i);

function buildDefaultPointsConfig(mc:number,tf:number,sa:number,writing:number):ExamPointsConfig{
  const s:SectionPointsConfig[]=[];
  if(mc>0)s.push({sectionId:"part1",sectionName:"PHẦN I. TRẮC NGHIỆM",questionType:"multiple_choice",totalQuestions:mc,totalPoints:3,pointsPerQuestion:parseFloat((3/mc).toFixed(4))});
  if(tf>0)s.push({sectionId:"part2",sectionName:"PHẦN II. ĐÚNG SAI",questionType:"true_false",totalQuestions:tf,totalPoints:4,pointsPerQuestion:parseFloat((4/tf).toFixed(4)),trueFalseMode:"stepped"});
  if(sa>0)s.push({sectionId:"part3",sectionName:"PHẦN III. TRẢ LỜI NGẮN",questionType:"short_answer",totalQuestions:sa,totalPoints:2,pointsPerQuestion:parseFloat((2/sa).toFixed(4))});
  if(writing>0)s.push({sectionId:"part4",sectionName:"PHẦN IV. TỰ LUẬN",questionType:"writing" as any,totalQuestions:writing,totalPoints:1,pointsPerQuestion:parseFloat((1/writing).toFixed(4))});
  return{maxScore:s.reduce((a,x)=>a+x.totalPoints,0)||10,sections:s,autoBalance:false};
}

function buildExamData(c:PDFExamConfig,mcA:MCAnswers,tfA:TFAnswers,saA:SAAnswers,wrA:WritingAnswers){
  const questions:Question[]=[],answers:{[k:number]:string}={};
  mcRange(c.mcCount).forEach(n=>{const a=mcA[n]||"";questions.push({number:n,text:`Câu ${n}`,type:"multiple_choice",options:["A","B","C","D"].map(l=>({letter:l,text:l})),correctAnswer:a||null,part:"PHẦN I"});if(a)answers[n]=a;});
  tfRange(c.tfCount).forEach((n,idx)=>{const cells=tfA[n]||["","","",""];const tfMap:Record<string,boolean>={};["a","b","c","d"].forEach((l,i)=>{tfMap[l]=cells[i]==="Đ";});const has=cells.some(c=>c==="Đ"||c==="S");questions.push({number:n,text:`Câu ${idx+1}`,type:"true_false",options:[],correctAnswer:has?JSON.stringify(tfMap):null,part:"PHẦN II"});if(has)answers[n]=JSON.stringify(tfMap);});
  saRange(c.saCount).forEach((n,idx)=>{const a=saA[n]||"";questions.push({number:n,text:`Câu ${idx+1}`,type:"short_answer",options:[],correctAnswer:a||null,part:"PHẦN III"});if(a)answers[n]=a;});
  writingRange(c.writingCount).forEach((n,idx)=>{questions.push({number:n,text:`Câu tự luận ${idx+1}`,type:"writing" as any,options:[],correctAnswer:null,solution:wrA[n]||undefined,part:"PHẦN IV"});});
  const sections:ExamSection[]=[];
  if(c.mcCount>0)sections.push({name:"PHẦN I. TRẮC NGHIỆM",description:`Câu 1–${c.mcCount}`,points:"3",questions:questions.filter(q=>q.part==="PHẦN I"),sectionType:"multiple_choice"});
  if(c.tfCount>0)sections.push({name:"PHẦN II. ĐÚNG SAI",description:`Câu 1–${c.tfCount}`,points:"4",questions:questions.filter(q=>q.part==="PHẦN II"),sectionType:"true_false"});
  if(c.saCount>0)sections.push({name:"PHẦN III. TRẢ LỜI NGẮN",description:`Câu 1–${c.saCount}`,points:"2",questions:questions.filter(q=>q.part==="PHẦN III"),sectionType:"short_answer"});
  if(c.writingCount>0)sections.push({name:"PHẦN IV. TỰ LUẬN",description:`Câu 1–${c.writingCount}`,points:"1",questions:questions.filter(q=>q.part==="PHẦN IV"),sectionType:"writing" as any});
  return{questions,sections,answers};
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function StepIndicator({step}:{step:number}){
  const labels=["1.Đề thi","2.Lời giải","3.Số câu","4.Đáp án","5.Lưu"];
  return(<div className="flex items-center gap-0.5 mb-6 overflow-x-auto pb-1">{labels.map((label,i)=>{const s=i+1,active=step===s,done=step>s;return(<React.Fragment key={s}><div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${active?"bg-teal-600 text-white":done?"bg-teal-100 text-teal-700":"bg-gray-100 text-gray-400"}`}><span>{done?"✓":s}</span><span className="hidden sm:inline">{label}</span></div>{i<4&&<div className="flex-1 h-0.5 bg-gray-200 mx-0.5 rounded min-w-[8px]"/>}</React.Fragment>);})}</div>);
}

interface DriveUploadBlockProps{label:string;pdfBase64:string;pdfFileName:string;pdfSizeKB:number;examTitle:string;result:DriveUploadResult|null;status:UploadStatus;error:string;onUpload:()=>void;onReset:()=>void;}
function DriveUploadBlock({label,pdfBase64,pdfFileName,pdfSizeKB,result,status,error,onUpload,onReset}:DriveUploadBlockProps){
  const bc=result?"border-green-300 bg-green-50":status==="error"?"border-red-300 bg-red-50":"border-blue-200 bg-blue-50";
  return(<div className={`rounded-xl border-2 p-4 mb-3 ${bc}`}><div className="flex items-start gap-3"><span className="text-2xl mt-0.5">{result?"✅":status==="error"?"❌":status==="uploading"?"⏫":"📂"}</span><div className="flex-1 min-w-0"><p className="font-semibold text-sm text-gray-800">{label}</p>{result&&<><p className="text-xs text-green-700 mt-1">✓ Drive — {Math.round((result.sizeBytes||0)/1024)} KB</p><button onClick={onReset} className="mt-1 text-xs text-gray-400 underline">Upload lại</button></>}{status==="uploading"&&!result&&<p className="text-xs text-blue-700 mt-1 animate-pulse">⏳ {pdfFileName} ({pdfSizeKB} KB)…</p>}{status==="error"&&<><p className="text-xs text-red-700 mt-1">{error}</p><button onClick={onUpload} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-xs">Thử lại</button></>}{status==="idle"&&!result&&<><p className="text-xs text-gray-500 mt-1">{pdfFileName} ({pdfSizeKB} KB)</p><button onClick={onUpload} disabled={!pdfBase64} className="mt-2 px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">☁️ Upload Google Drive</button></>}</div></div></div>);
}

interface SectionRowProps{icon:string;color:"blue"|"purple"|"orange"|"green";title:string;desc:string;value:number;onChange:(v:number)=>void;rangeLabel:string;}
function SectionRow({icon,color,title,desc,value,onChange,rangeLabel}:SectionRowProps){
  const bc={blue:"border-blue-200 bg-blue-50",purple:"border-purple-200 bg-purple-50",orange:"border-orange-200 bg-orange-50",green:"border-green-200 bg-green-50"}[color];
  const tc={blue:"text-blue-800",purple:"text-purple-800",orange:"text-orange-800",green:"text-green-800"}[color];
  return(<div className={`border rounded-xl p-4 ${bc}`}><div className="flex items-start gap-3"><span className="text-2xl">{icon}</span><div className="flex-1 min-w-0"><p className={`font-semibold text-sm ${tc}`}>{title}</p><p className="text-xs text-gray-500 mt-0.5">{desc}</p><p className="text-xs text-gray-400 mt-1">📌 {rangeLabel}</p></div><div className="flex items-center gap-2 shrink-0"><button onClick={()=>onChange(Math.max(0,value-1))} className="w-7 h-7 rounded-full bg-white border border-gray-300 font-bold hover:bg-gray-100">−</button><input type="number" min={0} max={40} value={value} onChange={e=>onChange(Math.max(0,Number(e.target.value)))} className="w-14 text-center border border-gray-300 rounded-lg py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"/><button onClick={()=>onChange(value+1)} className="w-7 h-7 rounded-full bg-white border border-gray-300 font-bold hover:bg-gray-100">+</button></div></div></div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
interface PDFExamCreatorProps{teacherId:string;teacherName:string;onSave:(exam:Omit<Exam,"id"|"createdAt"|"updatedAt">)=>Promise<void>;onCancel:()=>void;}

const PDFExamCreator:React.FC<PDFExamCreatorProps>=({teacherId,onSave,onCancel})=>{
  const [step,setStep]=useState<1|2|3|4|5>(1);
  const [isSaving,setIsSaving]=useState(false);
  const answerFileInputRef=useRef<HTMLInputElement>(null);

  // Step 1
  const [pdfBase64,setPdfBase64]=useState("");const [pdfFileName,setPdfFileName]=useState("");const [pdfSizeKB,setPdfSizeKB]=useState(0);
  const [config,setConfig]=useState<PDFExamConfig>({title:"",timeLimit:90,mcCount:12,tfCount:4,saCount:6,writingCount:0});
  const [overlayMode,setOverlayMode]=useState(true);
  const examFileRef=useRef<HTMLInputElement>(null);

  // Step 2
  const [solutionBase64,setSolutionBase64]=useState("");const [solutionFileName,setSolutionFileName]=useState("");const [solutionSizeKB,setSolutionSizeKB]=useState(0);
  const [solutionMode,setSolutionMode]=useState<SolutionMode>("split");const [solutionTotalPages,setSolutionTotalPages]=useState(0);
  const [questionSolutions,setQuestionSolutions]=useState<SolutionRanges>({});const [isDetecting,setIsDetecting]=useState(false);
  const [detectError,setDetectError]=useState("");const [detectDone,setDetectDone]=useState(false);const [addManualQ,setAddManualQ]=useState("");
  const solutionFileRef=useRef<HTMLInputElement>(null);

  // Step 4
  const [mcAnswers,setMcAnswers]=useState<MCAnswers>({});const [tfAnswers,setTfAnswers]=useState<TFAnswers>({});
  const [saAnswers,setSaAnswers]=useState<SAAnswers>({});const [writingAnswers,setWritingAnswers]=useState<WritingAnswers>({});

  // Step 5 overlay
  const [previewPages,setPreviewPages]=useState<PreviewPage[]>([]);
  const [overlayControls,setOverlayControls]=useState<OverlayCtrl[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [previewLoading,setPreviewLoading]=useState(false);
  const [previewError,setPreviewError]=useState("");
  const [isDragging,setIsDragging]=useState(false);

  // Drag/Resize refs — useRef for zero-rerender during drag
  const dragRef=useRef<{id:string;sx:number;sy:number;ix:number;iy:number;pw:number;ph:number}|null>(null);
  const resizeRef=useRef<{id:string;sx:number;sy:number;iw:number;ih:number;pw:number}|null>(null);
  const pageEls=useRef<Map<number,HTMLDivElement>>(new Map());

  // Step 5 drive
  const [pointsConfig,setPointsConfig]=useState<ExamPointsConfig|null>(null);
  const [uploadStatus,setUploadStatus]=useState<UploadStatus>("idle");const [uploadError,setUploadError]=useState("");const [driveResult,setDriveResult]=useState<DriveUploadResult|null>(null);
  const [solUploadStatus,setSolUploadStatus]=useState<UploadStatus>("idle");const [solUploadError,setSolUploadError]=useState("");const [solDriveResult,setSolDriveResult]=useState<DriveUploadResult|null>(null);

  // ── Drag handlers ────────────────────────────────────────────────────────
  const onCtrlMouseDown=useCallback((e:React.MouseEvent,ctrl:OverlayCtrl)=>{
    e.preventDefault();e.stopPropagation();
    const el=pageEls.current.get(ctrl.page);if(!el)return;
    const r=el.getBoundingClientRect();
    dragRef.current={id:ctrl.id,sx:e.clientX,sy:e.clientY,ix:ctrl.xPct,iy:ctrl.yPct,pw:r.width,ph:r.height};
    setSelectedId(ctrl.id);setIsDragging(true);
  },[]);

  const onResizeMouseDown=useCallback((e:React.MouseEvent,ctrl:OverlayCtrl)=>{
    e.preventDefault();e.stopPropagation();
    const el=pageEls.current.get(ctrl.page);if(!el)return;
    const r=el.getBoundingClientRect();
    resizeRef.current={id:ctrl.id,sx:e.clientX,sy:e.clientY,iw:ctrl.widthPct??56,ih:ctrl.heightPx??30,pw:r.width};
    setIsDragging(true);
  },[]);

  const onPreviewMouseMove=useCallback((e:React.MouseEvent)=>{
    if(dragRef.current){
      const d=dragRef.current;
      setOverlayControls(p=>p.map(c=>c.id!==d.id?c:{...c,
        xPct:Math.max(0,Math.min(98,d.ix+((e.clientX-d.sx)/d.pw)*100)),
        yPct:Math.max(0,Math.min(98,d.iy+((e.clientY-d.sy)/d.ph)*100)),
      }));
    }
    if(resizeRef.current){
      const r=resizeRef.current;
      setOverlayControls(p=>p.map(c=>c.id!==r.id?c:{...c,
        widthPct:Math.max(20,Math.min(95,r.iw+((e.clientX-r.sx)/r.pw)*100)),
        heightPx:Math.max(24,Math.min(300,r.ih+(e.clientY-r.sy))),
      }));
    }
  },[]);

  const onPreviewMouseUp=useCallback(()=>{dragRef.current=null;resizeRef.current=null;setIsDragging(false);},[]);

  const updateCtrl=(id:string,patch:Partial<OverlayCtrl>)=>setOverlayControls(p=>p.map(c=>c.id===id?{...c,...patch}:c));
  const removeCtrl=(id:string)=>{setOverlayControls(p=>p.filter(c=>c.id!==id));setSelectedId(p=>p===id?"":p);};

  // ── File handlers ─────────────────────────────────────────────────────────
  const handleExamFile=useCallback((file:File)=>{
    if(file.type!=="application/pdf"){alert("Vui lòng chọn file PDF.");return;}
    if(file.size>50*1024*1024){alert("File quá lớn (tối đa 50 MB).");return;}
    setDriveResult(null);setUploadStatus("idle");setUploadError("");
    const r=new FileReader();r.onload=e=>{const res=e.target?.result as string;setPdfBase64(res.split(",")[1]);setPdfFileName(file.name);setPdfSizeKB(Math.round(file.size/1024));};r.readAsDataURL(file);
  },[]);

  const handleSolutionFile=useCallback((file:File)=>{
    if(file.type!=="application/pdf"){alert("Vui lòng chọn file PDF.");return;}
    setSolDriveResult(null);setSolUploadStatus("idle");setSolUploadError("");setDetectDone(false);setDetectError("");setQuestionSolutions({});
    const r=new FileReader();r.onload=e=>{const res=e.target?.result as string;setSolutionBase64(res.split(",")[1]);setSolutionFileName(file.name);setSolutionSizeKB(Math.round(file.size/1024));};r.readAsDataURL(file);
  },[]);

  // ── Detect solution pages ──────────────────────────────────────────────────
  const handleDetect=async()=>{
    if(!solutionBase64)return;setIsDetecting(true);setDetectError("");setDetectDone(false);
    try{
      const lib=await loadPdfJs();const raw=atob(solutionBase64);const buf=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)buf[i]=raw.charCodeAt(i);
      const pdf=await lib.getDocument({data:buf}).promise;const n:number=pdf.numPages;setSolutionTotalPages(n);
      const fp=new Map<number,number>();
      for(let p=1;p<=n;p++){const page=await pdf.getPage(p);const content=await page.getTextContent();const text=content.items.map((it:any)=>it.str||"").join(" ");const re=/C[âa]u\s*(\d+)\s*[.:\)]/gi;let m:RegExpExecArray|null;while((m=re.exec(text))!==null){const qn=parseInt(m[1],10);if(qn>0&&qn<=200&&!fp.has(qn))fp.set(qn,p);}}
      const sorted=[...fp.entries()].sort((a,b)=>a[0]-b[0]);const ranges:SolutionRanges={};
      sorted.forEach(([qn,sp],idx)=>{const nsp=idx<sorted.length-1?sorted[idx+1][1]:n+1;ranges[qn]={pageStart:sp,pageEnd:Math.max(sp,nsp-1)};});
      setQuestionSolutions(ranges);setDetectDone(true);
      if(Object.keys(ranges).length===0)setDetectError('Không tìm thấy "Câu X." — thêm thủ công bên dưới.');
    }catch(err:any){setDetectError("Lỗi: "+(err?.message||"không xác định"));}finally{setIsDetecting(false);}
  };

  const updateRange=(qn:number,field:"pageStart"|"pageEnd",val:number)=>setQuestionSolutions(p=>({...p,[qn]:{...p[qn],[field]:Math.max(1,Math.min(solutionTotalPages||999,val))}}));
  const addManualQuestion=()=>{const qn=parseInt(addManualQ,10);if(!qn||qn<=0||qn>200){alert("Số câu 1–200");return;}if(questionSolutions[qn]){alert(`Câu ${qn} đã có`);return;}setQuestionSolutions(p=>({...p,[qn]:{pageStart:1,pageEnd:1}}));setAddManualQ("");};

  // ── Import TXT ──────────────────────────────────────────────────────────────
  const handleImportAnswers=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();reader.onload=ev=>{try{const content=ev.target?.result as string;const mc:MCAnswers={},tf:TFAnswers={},sa:SAAnswers={};content.split("\n").forEach(line=>{const p=line.split("|").map(x=>x.trim());if(p.length<3)return;const[part,qi,ans]=p;const q=parseInt(qi);if(part==="P1")mc[q]=ans.toUpperCase();else if(part==="P2")tf[200+q]=ans.split("").map(c=>c.toUpperCase()==="D"||c==="Đ"?"Đ":"S");else if(part==="P3")sa[300+q]=ans;});setMcAnswers(p=>({...p,...mc}));setTfAnswers(p=>({...p,...tf}));setSaAnswers(p=>({...p,...sa}));}catch{alert("Định dạng file không hợp lệ!");}finally{if(answerFileInputRef.current)answerFileInputRef.current.value="";}};reader.readAsText(file);
  };

  // ── Build overlay preview ──────────────────────────────────────────────────
  const buildOverlayPreview=async()=>{
    if(!pdfBase64)return;setPreviewLoading(true);setPreviewError("");
    try{
      const lib=await loadPdfJs();const raw=atob(pdfBase64);const buf=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)buf[i]=raw.charCodeAt(i);
      const pdf=await lib.getDocument({data:buf,cMapUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",cMapPacked:true,useSystemFonts:true}).promise;
      const pages:PreviewPage[]=[],txtAll:TxtItem[]=[];
      for(let i=0;i<pdf.numPages;i++){
        const page=await pdf.getPage(i+1);const vp1=page.getViewport({scale:1});const vp=page.getViewport({scale:1.35});
        const canvas=document.createElement("canvas");canvas.width=vp.width;canvas.height=vp.height;
        await page.render({canvasContext:canvas.getContext("2d")!,viewport:vp}).promise;
        pages.push({src:canvas.toDataURL("image/jpeg",0.88)});
        const content=await page.getTextContent({includeMarkedContent:true} as any);
        for(const rawItem of content.items){if(!("str" in rawItem))continue;const it=rawItem as any;if(!it.str?.trim())continue;txtAll.push({str:it.str.trim(),x:it.transform[4],y:it.transform[5],w:it.width??0,page:i,pw:vp1.width,ph:vp1.height});}
      }
      const detected=detectPdfOverlayControls(txtAll,config.mcCount,config.tfCount,config.saCount,config.writingCount);
      setPreviewPages(pages);
      setOverlayControls(prev=>prev.length>0?prev:detected);
      if(detected.length>0)setSelectedId(detected[0].id);
    }catch(err:any){setPreviewError("Lỗi: "+(err?.message||"không xác định"));}finally{setPreviewLoading(false);}
  };

  // ── Thêm thủ công Đ/S còn thiếu ──────────────────────────────────────────
  const addMissingTFControls=()=>{
    setOverlayControls(prev=>{
      const next=[...prev];
      const byId=new Set(next.map(c=>c.id));
      const sp=next.find(c=>c.kind==="tf_sub")?.page??0;
      for(let qi=0;qi<config.tfCount;qi++){
        for(let si=0;si<4;si++){
          const qNum=201+qi;
          const letter="abcd"[si];
          const id=`tf-${qNum}-${letter}`;
          if(!byId.has(id))next.push({id,kind:"tf_sub",qNum,letter,page:sp,xPct:8,yPct:20+qi*16+si*4});
        }
      }
      return next;
    });
  };

  // ── Thêm thủ công MC còn thiếu ───────────────────────────────────────────
  // Với mỗi câu trắc nghiệm, kiểm tra phương án A/B/C/D nào chưa có overlay
  // và tự động thêm vào ở vị trí mặc định để người dùng kéo thả chỉnh lại.
  const addMissingMCControls=()=>{
    setOverlayControls(prev=>{
      const next=[...prev];
      const byId=new Set(next.map(c=>c.id));
      // Lấy trang chứa MC đầu tiên đã detect được, fallback về trang 0
      const sp=next.find(c=>c.kind==="mc_opt")?.page??0;
      for(let qi=0;qi<config.mcCount;qi++){
        const qNum=qi+1;
        ["A","B","C","D"].forEach((letter,li)=>{
          const id=`mc-${qNum}-${letter}`;
          if(!byId.has(id)){
            // Xếp 4 phương án ngang hàng, mỗi câu cách nhau ~5% theo chiều dọc
            next.push({
              id,
              kind:"mc_opt",
              qNum,
              letter,
              page:sp,
              xPct:15+li*20,          // A=15%, B=35%, C=55%, D=75% (theo chiều ngang)
              yPct:10+qi*5,            // mỗi câu cách nhau 5% theo chiều dọc
            });
          }
        });
      }
      return next;
    });
  };

  // ── Drive uploads ──────────────────────────────────────────────────────────
  const handleUploadExam=async()=>{if(!pdfBase64)return;setUploadStatus("uploading");setUploadError("");try{const res=await uploadPDFToGoogleDrive(pdfBase64,pdfFileName||`${config.title.trim()||"dethi"}.pdf`);setDriveResult(res);setUploadStatus("done");}catch(err:any){setUploadStatus("error");setUploadError(err?.message||"Lỗi");}};
  const handleUploadSolution=async()=>{if(!solutionBase64)return;setSolUploadStatus("uploading");setSolUploadError("");try{const res=await uploadPDFToGoogleDrive(solutionBase64,solutionFileName||"loigiai.pdf");setSolDriveResult(res);setSolUploadStatus("done");}catch(err:any){setSolUploadStatus("error");setSolUploadError(err?.message||"Lỗi");}};

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave=async()=>{
    if(!pointsConfig||!driveResult)return;setIsSaving(true);
    try{
      const{questions,sections,answers}=buildExamData(config,mcAnswers,tfAnswers,saAnswers,writingAnswers);
      const hasSol=solutionBase64&&solDriveResult;
      await onSave({title:config.title.trim(),timeLimit:config.timeLimit,questions,sections,answers,createdBy:teacherId,pointsConfig,overlayMode,...(overlayMode&&overlayControls.length>0&&{pdfOverlayControls:overlayControls}),pdfDriveUrl:driveResult.viewUrl,pdfDriveFileId:driveResult.fileId,...(hasSol&&{solutionPdfDriveUrl:solDriveResult.viewUrl,solutionPdfDriveFileId:solDriveResult.fileId}),...(hasSol&&solutionMode==="split"&&{questionSolutions})} as any);
    }catch(err){console.error(err);alert("Có lỗi khi lưu. Thử lại.");}finally{setIsSaving(false);}
  };

  const step1Valid=!!(pdfBase64&&config.title.trim()&&config.timeLimit>0&&config.mcCount+config.tfCount+config.saCount+config.writingCount>0);
  const enterStep5=()=>{if(!pointsConfig)setPointsConfig(buildDefaultPointsConfig(config.mcCount,config.tfCount,config.saCount,config.writingCount));setStep(5);};
  const totalSolutions=Object.keys(questionSolutions).length;
  const sortedQNums=Object.keys(questionSolutions).map(Number).sort((a,b)=>a-b);
  const selCtrl=overlayControls.find(c=>c.id===selectedId);

  // ── Computed: số MC / TF controls còn thiếu (để hiện badge trên nút) ──────
  const missingMCCount=(()=>{
    const present=new Set(overlayControls.filter(c=>c.kind==="mc_opt").map(c=>`${c.qNum}-${c.letter}`));
    let miss=0;
    for(let qi=0;qi<config.mcCount;qi++)
      for(const l of["A","B","C","D"])
        if(!present.has(`${qi+1}-${l}`))miss++;
    return miss;
  })();

  const missingTFCount=(()=>{
    const present=new Set(overlayControls.filter(c=>c.kind==="tf_sub").map(c=>`${c.qNum}-${c.letter}`));
    let miss=0;
    for(let qi=0;qi<config.tfCount;qi++)
      for(const l of["a","b","c","d"])
        if(!present.has(`${201+qi}-${l}`))miss++;
    return miss;
  })();

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1
  // ══════════════════════════════════════════════════════════════════════════
  if(step===1)return(
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-2xl shadow-lg">
      <StepIndicator step={1}/>
      <h2 className="text-xl font-bold text-gray-800 mb-1">📄 Tải đề thi PDF</h2>
      <p className="text-sm text-gray-500 mb-5">Upload file PDF <strong>không có lời giải</strong></p>
      <div onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleExamFile(f);}} onDragOver={e=>e.preventDefault()} onClick={()=>examFileRef.current?.click()} className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${pdfBase64?"border-teal-400 bg-teal-50":"border-gray-300 bg-gray-50 hover:border-teal-400"}`}>
        <input ref={examFileRef} type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleExamFile(f);}}/>
        {pdfBase64?(<><p className="text-3xl mb-2">✅</p><p className="font-semibold text-teal-700">{pdfFileName}</p><p className="text-sm text-teal-600">{pdfSizeKB} KB — nhấn để đổi</p></>):(<><p className="text-5xl mb-3">📄</p><p className="font-semibold text-gray-600">Kéo thả hoặc nhấn để chọn PDF</p><p className="text-sm text-gray-400 mt-1">Tối đa 50 MB</p></>)}
      </div>
      {pdfBase64&&(
        <div className="mt-5 space-y-4">
          <div><label className="text-sm font-medium text-gray-700">Tiêu đề đề thi *</label><input type="text" placeholder="VD: Kiểm tra Toán 10 HK1 2024-2025" value={config.title} onChange={e=>setConfig(c=>({...c,title:e.target.value}))} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"/></div>
          <div><label className="text-sm font-medium text-gray-700">Thời gian (phút) *</label><input type="number" min={5} max={300} value={config.timeLimit} onChange={e=>setConfig(c=>({...c,timeLimit:Number(e.target.value)}))} className="mt-1 w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"/></div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Chế độ hiển thị phòng thi</label>
            <div className="grid grid-cols-2 gap-3">
              {[{v:true,icon:"🖊️",title:"Overlay trực tiếp PDF",desc:"Vẽ nút A/B/C/D, [Đ][S], ô nhập ngay trên trang PDF — trải nghiệm thi như giấy"},{v:false,icon:"📋",title:"Panel bên phải",desc:"PDF ở trái, bảng trả lời ở phải — phù hợp PDF scan hoặc màn hình lớn"}].map(({v,icon,title,desc})=>(
                <button key={String(v)} type="button" onClick={()=>setOverlayMode(v)} className={`relative p-3 rounded-xl border-2 text-left transition-all ${overlayMode===v?"border-teal-500 bg-teal-50":"border-gray-200 bg-white hover:border-gray-300"}`}>
                  {overlayMode===v&&<span className="absolute top-2 right-2 text-teal-600 text-xs font-bold">✓</span>}
                  <div className="flex items-center gap-2 mb-1.5"><span className="text-lg">{icon}</span><span className={`text-sm font-semibold ${overlayMode===v?"text-teal-800":"text-gray-700"}`}>{title}</span></div>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="flex justify-between mt-6">
        <button onClick={onCancel} className="px-5 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Hủy</button>
        <button disabled={!step1Valid} onClick={()=>setStep(2)} className="px-6 py-2 bg-teal-600 text-white rounded-lg font-semibold disabled:opacity-40 hover:bg-teal-700">Tiếp theo →</button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2
  // ══════════════════════════════════════════════════════════════════════════
  if(step===2)return(
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-2xl shadow-lg">
      <StepIndicator step={2}/>
      <h2 className="text-xl font-bold text-gray-800 mb-1">📋 PDF Lời Giải <span className="text-sm font-normal text-gray-400">(tùy chọn)</span></h2>
      <p className="text-sm text-gray-500 mb-5">Upload PDF <strong>có lời giải</strong> để học sinh xem sau khi nộp</p>
      <div onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleSolutionFile(f);}} onDragOver={e=>e.preventDefault()} onClick={()=>solutionFileRef.current?.click()} className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition mb-4 ${solutionBase64?"border-purple-400 bg-purple-50":"border-gray-300 bg-gray-50 hover:border-purple-400"}`}>
        <input ref={solutionFileRef} type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleSolutionFile(f);}}/>
        {solutionBase64?(<><p className="text-3xl mb-2">📋</p><p className="font-semibold text-purple-700">{solutionFileName}</p><p className="text-sm text-purple-500">{solutionSizeKB} KB</p></>):(<><p className="text-4xl mb-3">📋</p><p className="font-semibold text-gray-600">Kéo thả hoặc nhấn để chọn PDF lời giải</p><p className="text-sm text-gray-400 mt-1">Tối đa 50 MB</p></>)}
      </div>
      {solutionBase64&&<div className="mb-4 bg-purple-50 p-4 rounded-xl border border-purple-200"><label className="font-semibold text-purple-900 block mb-2">⚙️ Chế độ:</label><div className="flex gap-6">{[{v:"split",l:"Cắt theo từng câu"},{v:"full",l:"Nguyên bản"}].map(({v,l})=>(<label key={v} className="flex items-center gap-2 cursor-pointer"><input type="radio" name="solMode" checked={solutionMode===v} onChange={()=>{setSolutionMode(v as SolutionMode);if(v==="full")setDetectDone(true);else setDetectDone(false);}} className="accent-purple-600 w-4 h-4"/><span className="text-sm text-purple-800 font-medium">{l}</span></label>))}</div></div>}
      {solutionBase64&&solutionMode==="split"&&<button onClick={handleDetect} disabled={isDetecting} className={`w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 mb-4 ${isDetecting?"bg-purple-200 text-purple-500 cursor-not-allowed":"bg-purple-600 text-white hover:bg-purple-700"}`}>{isDetecting?<><span className="animate-spin">⚙️</span> Đang phân tích...</>:<><span>🔍</span> Phân tích trang</>}</button>}
      {detectError&&solutionMode==="split"&&<div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-800">⚠️ {detectError}</div>}
      {detectDone&&solutionMode==="split"&&<div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-sm text-green-800"><span className="text-xl">✅</span><span>Phát hiện <strong>{totalSolutions} câu</strong> · <strong>{solutionTotalPages} trang</strong></span></div>}
      {totalSolutions>0&&solutionMode==="split"&&(
        <div className="mb-4 border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between"><span className="text-xs font-semibold text-gray-600 uppercase">Ranh giới trang</span><span className="text-xs text-gray-400">{solutionTotalPages} trang</span></div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {sortedQNums.map(qn=>{const range=questionSolutions[qn];const inv=range.pageStart>range.pageEnd;return(
              <div key={qn} className={`flex items-center gap-3 px-4 py-2.5 ${inv?"bg-red-50":"hover:bg-gray-50"}`}>
                <span className="bg-purple-100 text-purple-800 text-xs font-bold px-2.5 py-1 rounded-full min-w-[60px] text-center">Câu {qn}</span>
                <span className="text-xs text-gray-500">Trang</span>
                <input type="number" min={1} max={solutionTotalPages||999} value={range.pageStart} onChange={e=>updateRange(qn,"pageStart",parseInt(e.target.value)||1)} className={`w-14 border rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-400 ${inv?"border-red-400":"border-gray-300"}`}/>
                <span className="text-gray-400">→</span>
                <input type="number" min={1} max={solutionTotalPages||999} value={range.pageEnd} onChange={e=>updateRange(qn,"pageEnd",parseInt(e.target.value)||1)} className={`w-14 border rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-400 ${inv?"border-red-400":"border-gray-300"}`}/>
                <button onClick={()=>setQuestionSolutions(p=>{const n={...p};delete n[qn];return n;})} className="ml-auto text-gray-300 hover:text-red-500 text-lg">✕</button>
              </div>
            );})}
          </div>
        </div>
      )}
      {solutionBase64&&solutionMode==="split"&&<div className="mb-4 flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-xl"><span className="text-sm text-gray-600 shrink-0">➕ Thêm câu:</span><input type="number" min={1} max={200} placeholder="Số câu" value={addManualQ} onChange={e=>setAddManualQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addManualQuestion();}} className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-400"/><button onClick={addManualQuestion} className="px-3 py-1 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 font-semibold">Thêm</button></div>}
      <div className="flex justify-between mt-4">
        <div className="flex gap-2"><button onClick={()=>setStep(1)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 text-sm">← Quay lại</button><button onClick={()=>{setSolutionBase64("");setQuestionSolutions({});setDetectDone(false);setStep(3);}} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-400 text-sm">Bỏ qua</button></div>
        <button onClick={()=>setStep(3)} className="px-6 py-2 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 text-sm">{totalSolutions>0&&solutionMode==="split"?`Tiếp (${totalSolutions} câu) →`:"Tiếp →"}</button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3
  // ══════════════════════════════════════════════════════════════════════════
  if(step===3)return(
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-2xl shadow-lg">
      <StepIndicator step={3}/>
      <h2 className="text-xl font-bold text-gray-800 mb-1">⚙️ Cấu hình số câu</h2>
      <p className="text-sm text-gray-500 mb-5">Nhập số lượng câu từng phần</p>
      <div className="space-y-3">
        <SectionRow icon="🔘" color="blue" title="PHẦN I – Trắc nghiệm" desc="A/B/C/D" rangeLabel={`Câu 1–${config.mcCount}`} value={config.mcCount} onChange={v=>setConfig(c=>({...c,mcCount:v}))}/>
        <SectionRow icon="☑️" color="purple" title="PHẦN II – Đúng/Sai" desc="4 ý a/b/c/d" rangeLabel={`Câu 201–${200+config.tfCount}`} value={config.tfCount} onChange={v=>setConfig(c=>({...c,tfCount:v}))}/>
        <SectionRow icon="✍️" color="orange" title="PHẦN III – Trả lời ngắn" desc="Nhập số" rangeLabel={`Câu 301–${300+config.saCount}`} value={config.saCount} onChange={v=>setConfig(c=>({...c,saCount:v}))}/>
        <SectionRow icon="📝" color="green" title="PHẦN IV – Tự luận" desc="Chấm thủ công / AI" rangeLabel={`Câu 401–${400+config.writingCount}`} value={config.writingCount} onChange={v=>setConfig(c=>({...c,writingCount:v}))}/>
      </div>
      <div className="flex justify-between mt-6">
        <button onClick={()=>setStep(2)} className="px-5 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">← Quay lại</button>
        <button onClick={()=>setStep(4)} disabled={config.mcCount+config.tfCount+config.saCount+config.writingCount===0} className="px-6 py-2 bg-teal-600 text-white rounded-lg font-semibold disabled:opacity-40 hover:bg-teal-700">Tiếp theo →</button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4
  // ══════════════════════════════════════════════════════════════════════════
  if(step===4){
    const mcNums=mcRange(config.mcCount),tfNums=tfRange(config.tfCount),saNums=saRange(config.saCount),wrNums=writingRange(config.writingCount);
    const aMC=Object.values(mcAnswers).filter(Boolean).length;
    const aTF=Object.values(tfAnswers).filter(v=>v&&v.filter(Boolean).length===4).length;
    const aSA=Object.values(saAnswers).filter(Boolean).length;
    return(
      <div className="max-w-3xl mx-auto p-6 bg-white rounded-2xl shadow-lg">
        <StepIndicator step={4}/>
        <div className="flex justify-between items-start mb-5 border-b pb-4">
          <div><h2 className="text-xl font-bold text-gray-800 mb-1">🔑 Nhập đáp án</h2><p className="text-sm text-gray-500">Điền đáp án đúng cho từng câu</p></div>
          <div><input type="file" accept=".txt" ref={answerFileInputRef} className="hidden" onChange={handleImportAnswers}/><button onClick={()=>answerFileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-sm font-bold hover:bg-amber-100">📥 Import .TXT</button></div>
        </div>

        {mcNums.length>0&&(
          <div className="mb-8">
            <div className="inline-block bg-teal-600 text-white px-4 py-1.5 rounded-full text-sm font-bold mb-4">🔘 PHẦN I — Trắc nghiệm ({aMC}/{mcNums.length})</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {mcNums.map(n=>(<div key={n} className="flex items-center gap-2 p-3 bg-cyan-50/50 border border-cyan-100 rounded-2xl"><span className="bg-teal-500 text-white text-xs font-bold px-2 py-1 rounded-full shrink-0">Câu {n}</span><div className="flex gap-1">{["A","B","C","D"].map(l=>(<button key={l} onClick={()=>setMcAnswers(p=>({...p,[n]:p[n]===l?"":l}))} className={`w-7 h-7 rounded-full text-xs font-bold transition ${mcAnswers[n]===l?({A:"bg-pink-500",B:"bg-sky-500",C:"bg-green-500",D:"bg-orange-500"} as any)[l]+" text-white":"bg-white border border-gray-300 text-gray-600 hover:bg-teal-50"}`}>{l}</button>))}</div></div>))}
            </div>
          </div>
        )}

        {tfNums.length>0&&(
          <div className="mb-8">
            <div className="inline-block bg-teal-600 text-white px-4 py-1.5 rounded-full text-sm font-bold mb-4">☑️ PHẦN II — Đúng/Sai ({aTF}/{tfNums.length})</div>
            <div className="space-y-3">
              {tfNums.map((n,idx)=>{const cells=tfAnswers[n]||["","","",""];return(
                <div key={n} className="p-3 bg-cyan-50/50 border border-cyan-100 rounded-2xl">
                  <div className="inline-block bg-teal-500 text-white text-xs font-bold px-2.5 py-1 rounded-full mb-3">Câu {idx+1}</div>
                  <div className="grid grid-cols-4 gap-3">
                    {["a","b","c","d"].map((lbl,i)=>(<div key={lbl} className="flex flex-col items-center gap-2"><span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${["bg-pink-500","bg-sky-500","bg-green-500","bg-orange-500"][i]}`}>{lbl.toUpperCase()}</span><div className="flex gap-1">{["Đ","S"].map(v=>(<button key={v} onClick={()=>setTfAnswers(p=>{const cur=p[n]||["","","",""];const next=[...cur];next[i]=next[i]===v?"":v;return{...p,[n]:next};})} className={`px-2 py-1 rounded text-xs font-bold transition ${cells[i]===v?v==="Đ"?"bg-green-500 text-white":"bg-red-500 text-white":"bg-white border border-gray-300 text-gray-600"}`}>{v}</button>))}</div></div>))}
                  </div>
                </div>
              );})}
            </div>
          </div>
        )}

        {saNums.length>0&&(
          <div className="mb-8">
            <div className="inline-block bg-teal-600 text-white px-4 py-1.5 rounded-full text-sm font-bold mb-4">✍️ PHẦN III — Trả lời ngắn ({aSA}/{saNums.length})</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {saNums.map((n,idx)=>{const cv=(saAnswers[n]||"").padEnd(4," ");const ca=cv.split("").slice(0,4);const hc=(ci:number,char:string)=>{const ic=char.slice(-1);if(ic===""){const nc=[...ca];nc[ci]=" ";setSaAnswers(p=>({...p,[n]:nc.join("").trimEnd()}));return;}const hComma=ca.some(c=>c===",");let isV=false;switch(ci){case 0:isV=/^[0-9-]$/.test(ic);break;case 1:case 2:isV=ic===","?!hComma:/^[0-9]$/.test(ic);break;case 3:isV=/^[0-9]$/.test(ic);break;}if(isV){const nc=[...ca];nc[ci]=ic;setSaAnswers(p=>({...p,[n]:nc.join("").trimEnd()}));if(ci<3)document.getElementById(`csa-${n}-${ci+1}`)?.focus();}};
              return(<div key={n} className="flex items-center gap-3 p-3 bg-cyan-50/50 border border-cyan-100 rounded-2xl"><span className="bg-teal-500 text-white text-[10px] font-bold px-2 py-1.5 rounded-full shrink-0 min-w-[60px] text-center">Câu {idx+1}</span><div className="flex gap-1.5">{[0,1,2,3].map(ci=>(<input key={ci} id={`csa-${n}-${ci}`} type="text" maxLength={1} value={ca[ci]===" "?"":ca[ci]} onChange={e=>hc(ci,e.target.value)} onKeyDown={e=>{if(e.key==="Backspace"&&(ca[ci]===" "||!ca[ci])&&ci>0)document.getElementById(`csa-${n}-${ci-1}`)?.focus();}} className="w-9 h-9 border-2 border-gray-300 rounded-lg text-center font-bold text-base focus:border-teal-500 outline-none bg-white shadow-inner"/>))}</div></div>);
              })}
            </div>
          </div>
        )}

        {wrNums.length>0&&<div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-2xl text-green-800 text-sm"><span className="font-bold text-lg">📝 PHẦN IV — Tự luận ({wrNums.length} câu)</span><p className="mt-2">Chấm thủ công hoặc AI — không cần nhập đáp án.</p></div>}

        <div className="flex justify-between mt-6">
          <button onClick={()=>setStep(3)} className="px-5 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">← Quay lại</button>
          <button onClick={enterStep5} className="px-6 py-2 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700">Tiếp theo →</button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 — Upload + Drag-Drop Overlay Editor + Điểm + Lưu
  // ══════════════════════════════════════════════════════════════════════════
  if(step===5){
    const answeredCount=Object.keys({...mcAnswers,...saAnswers}).length+Object.values(tfAnswers).filter(v=>v.filter(Boolean).length===4).length;
    const totalAutoQ=config.mcCount+config.tfCount+config.saCount;
    const canSave=!isSaving&&!!pointsConfig&&!!driveResult;

    // Control color map
    const ctrlColor=(kind:OverlayCtrlKind)=>({
      mc_opt:{bg:"#fdf2f8",border:"#ec4899",text:"#be185d",badge:"bg-pink-500"},
      tf_sub:{bg:"#f5f3ff",border:"#8b5cf6",text:"#6d28d9",badge:"bg-purple-500"},
      sa_box:{bg:"#eff6ff",border:"#3b82f6",text:"#1d4ed8",badge:"bg-blue-500"},
      wr_box:{bg:"#faf5ff",border:"#7c3aed",text:"#5b21b6",badge:"bg-violet-500"},
    }[kind]);

    return(
      <div className="max-w-4xl mx-auto p-6 bg-white rounded-2xl shadow-lg">
        <StepIndicator step={5}/>
        <h2 className="text-xl font-bold text-gray-800 mb-1">⚖️ Upload & Lưu đề</h2>
        <p className="text-sm text-gray-500 mb-5">Upload lên Google Drive, kiểm tra overlay, cấu hình điểm rồi lưu</p>

        {/* ════════════ DRAG-DROP OVERLAY EDITOR ════════════ */}
        {overlayMode&&(
          <div className="mb-6 rounded-2xl border-2 border-cyan-200 bg-cyan-50 overflow-hidden">

            {/* ── Header ── */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-cyan-600 to-teal-600">
              <div>
                <h3 className="font-bold text-white text-sm">🖊️ Chỉnh vị trí overlay — Kéo thả</h3>
                <p className="text-cyan-100 text-xs mt-0.5">Kéo để di chuyển · Góc ⬘ để resize (SA/TL) · Click để chọn</p>
                <p className="text-green-200 text-xs mt-1">✅ Vị trí sau chỉnh sửa sẽ được lưu khi nhấn <strong>Lưu đề thi</strong></p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {/* ── Detect / Re-detect ── */}
                <button
                  onClick={buildOverlayPreview}
                  disabled={previewLoading}
                  className="px-3 py-1.5 rounded-lg bg-white text-cyan-700 text-xs font-bold hover:bg-cyan-50 disabled:opacity-50 shadow-sm"
                >
                  {previewLoading?"⏳ Đang tạo…":previewPages.length?"🔄 Detect lại":"🔍 Tạo preview"}
                </button>

                {/* ── + MC thiếu (MỚI) ── */}
                {previewPages.length>0&&config.mcCount>0&&(
                  <button
                    onClick={addMissingMCControls}
                    className="relative px-3 py-1.5 rounded-lg bg-pink-600/80 text-white text-xs font-bold hover:bg-pink-600 border border-white/20 flex items-center gap-1.5"
                    title="Thêm thủ công các phương án A/B/C/D còn thiếu"
                  >
                    <span>+ MC thiếu</span>
                    {missingMCCount>0&&(
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white text-pink-700 text-[10px] font-black leading-none">
                        {missingMCCount>9?"9+":missingMCCount}
                      </span>
                    )}
                  </button>
                )}

                {/* ── + Đ/S thiếu ── */}
                {previewPages.length>0&&(
                  <button
                    onClick={addMissingTFControls}
                    className="relative px-3 py-1.5 rounded-lg bg-cyan-800/30 text-white text-xs font-bold hover:bg-cyan-800/50 border border-white/20 flex items-center gap-1.5"
                    title="Thêm thủ công các nút Đ/S còn thiếu"
                  >
                    <span>+ Đ/S thiếu</span>
                    {missingTFCount>0&&(
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white text-cyan-800 text-[10px] font-black leading-none">
                        {missingTFCount>9?"9+":missingTFCount}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>

            {previewError&&<div className="text-xs text-red-700 bg-red-50 border-b border-red-200 p-3">❌ {previewError}</div>}

            {/* ── Empty state ── */}
            {!previewPages.length&&!previewLoading&&(
              <div className="text-center py-10 text-cyan-700">
                <p className="text-5xl mb-3">🖼️</p>
                <p className="text-sm font-semibold mb-1">Nhấn "Tạo preview" để xem và chỉnh overlay</p>
                <p className="text-xs text-cyan-500 mb-4">pdf.js render từng trang · tự nhận diện A/B/C/D, [Đ][S], ô trả lời ngắn</p>
                <div className="mx-auto max-w-xs bg-white/60 rounded-xl p-3 text-xs text-left space-y-1.5 border border-cyan-200">
                  <p className="font-bold text-cyan-900 mb-2">📋 Thứ tự thực hiện:</p>
                  <p>1️⃣ Nhấn <strong>Tạo preview</strong> — auto-detect controls</p>
                  <p>2️⃣ Nếu thiếu: nhấn <strong>+ MC thiếu</strong> hoặc <strong>+ Đ/S thiếu</strong></p>
                  <p>3️⃣ <strong>Kéo thả</strong> để chỉnh vị trí</p>
                  <p>4️⃣ <strong>Upload Drive</strong> ở phía dưới</p>
                  <p>5️⃣ Nhấn <strong>Lưu đề thi</strong> — overlay được lưu cùng</p>
                </div>
              </div>
            )}
            {previewLoading&&(
              <div className="text-center py-14">
                <div className="w-10 h-10 border-4 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
                <p className="text-sm text-cyan-700 font-medium">Đang render PDF và nhận diện controls…</p>
              </div>
            )}

            {previewPages.length>0&&(
              <>
                {/* ── Toolbar: selected control info ── */}
                <div className={`px-4 py-2.5 border-b border-cyan-200 flex items-center gap-3 min-h-[46px] ${selCtrl?"bg-white":"bg-cyan-50"}`}>
                  {selCtrl?(
                    <>
                      <div className={`px-2.5 py-1 rounded-full text-xs font-bold text-white ${ctrlColor(selCtrl.kind).badge}`}>
                        {selCtrl.kind==="mc_opt"?`MC-${selCtrl.qNum} ${selCtrl.letter}`:selCtrl.kind==="tf_sub"?`Đ/S câu ${selCtrl.qNum-200} ${selCtrl.letter}`:selCtrl.kind==="sa_box"?`SA ${selCtrl.qNum-300}`:`TL ${selCtrl.qNum-400}`}
                      </div>
                      <span className="text-xs text-gray-500 font-mono">Trang {selCtrl.page+1} · X:{selCtrl.xPct.toFixed(1)}% · Y:{selCtrl.yPct.toFixed(1)}%{(selCtrl.kind==="sa_box"||selCtrl.kind==="wr_box")?` · W:${(selCtrl.widthPct??56).toFixed(0)}% · H:${selCtrl.heightPx??30}px`:""}</span>
                      <div className="flex gap-1 ml-auto">
                        {/* Fine nudge */}
                        {[["←",-0.5,0],["→",0.5,0],["↑",0,-0.5],["↓",0,0.5]].map(([lbl,dx,dy])=>(
                          <button key={lbl as string} onClick={()=>updateCtrl(selCtrl.id,{xPct:Math.max(0,Math.min(98,selCtrl.xPct+(dx as number))),yPct:Math.max(0,Math.min(98,selCtrl.yPct+(dy as number)))})} className="w-7 h-7 border border-gray-200 rounded text-xs hover:bg-gray-50 font-bold text-gray-600">{lbl}</button>
                        ))}
                        <button onClick={()=>removeCtrl(selCtrl.id)} className="px-2.5 h-7 border border-red-200 text-red-500 rounded text-xs hover:bg-red-50 font-bold">🗑</button>
                      </div>
                    </>
                  ):(
                    <span className="text-xs text-cyan-500 italic">{overlayControls.length} controls · nhấn vào control để chọn</span>
                  )}
                </div>

                {/* ── Preview canvas area ── */}
                <div
                  className="overflow-auto p-4 bg-gray-300 space-y-5 max-h-[72vh]"
                  style={{cursor:isDragging?"grabbing":"default"}}
                  onMouseMove={onPreviewMouseMove}
                  onMouseUp={onPreviewMouseUp}
                  onMouseLeave={onPreviewMouseUp}
                >
                  {previewPages.map((pg,pageIdx)=>(
                    <div key={pageIdx} className="relative mx-auto bg-white shadow-xl" style={{lineHeight:0,maxWidth:680}}
                      ref={el=>{if(el)pageEls.current.set(pageIdx,el);else pageEls.current.delete(pageIdx);}}>

                      {/* Page badge */}
                      <div className="absolute top-1.5 left-1.5 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none z-50 font-bold">Trang {pageIdx+1}</div>

                      <img src={pg.src} alt="" className="w-full block select-none" draggable={false}/>

                      {/* Overlay controls */}
                      {overlayControls.filter(c=>c.page===pageIdx).map(c=>{
                        const isSel=selectedId===c.id;
                        const col=ctrlColor(c.kind);
                        const base:React.CSSProperties={position:"absolute",left:`${c.xPct}%`,top:`${c.yPct}%`,cursor:isDragging&&isSel?"grabbing":"grab",zIndex:isSel?40:10,userSelect:"none"};

                        if(c.kind==="mc_opt"){
                          const optColors={A:"#ec4899",B:"#0ea5e9",C:"#22c55e",D:"#f97316"};
                          return(<div key={c.id} style={{...base,transform:"translate(-130%,-50%)",width:22,height:22,borderRadius:"50%",border:`2.5px solid ${isSel?"#06b6d4":(optColors as any)[c.letter!]||"#94a3b8"}`,background:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:(optColors as any)[c.letter!]||"#64748b",boxShadow:isSel?"0 0 0 3px #06b6d450, 0 2px 6px rgba(0,0,0,.2)":"0 1px 4px rgba(0,0,0,.25)"}}
                            onMouseDown={e=>onCtrlMouseDown(e,c)} title={`MC ${c.qNum} ${c.letter}`}>{c.letter}</div>);
                        }
                        if(c.kind==="tf_sub"){
                          return(<div key={c.id} style={{...base,transform:"translate(-115%,-50%)",display:"flex",gap:2}}
                            onMouseDown={e=>onCtrlMouseDown(e,c)} title={`TF ${c.qNum-200} ${c.letter}`}>
                            {["Đ","S"].map(v=>(<span key={v} style={{display:"inline-block",width:24,height:18,borderRadius:3,border:`1.5px solid ${isSel?"#06b6d4":v==="Đ"?"#15803d":"#b91c1c"}`,background:v==="Đ"?"#dcfce7":"#fee2e2",color:v==="Đ"?"#15803d":"#b91c1c",fontSize:9,fontWeight:900,textAlign:"center",lineHeight:"18px",boxShadow:isSel?"0 0 0 2px #06b6d450":undefined}}>{v}</span>))}
                          </div>);
                        }
                        // SA / WR
                        const w=c.widthPct??56,h=c.heightPx??30;
                        return(
                          <div key={c.id} style={{...base,width:`${w}%`,height:h,border:`2px solid ${isSel?"#06b6d4":col.border}`,borderRadius:6,background:col.bg,boxShadow:isSel?"0 0 0 2px #06b6d450":"0 1px 4px rgba(0,0,0,.15)",overflow:"hidden"}}
                            onMouseDown={e=>onCtrlMouseDown(e,c)}>
                            <span style={{display:"block",fontSize:10,fontWeight:700,color:col.text,padding:"3px 7px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                              {c.kind==="sa_box"?`📝 TLN ${c.qNum-300}`:`✏️ TL ${c.qNum-400}`}
                            </span>
                            {/* Resize handle */}
                            <div
                              title="Kéo để resize"
                              style={{position:"absolute",right:0,bottom:0,width:16,height:16,cursor:"se-resize",background:`linear-gradient(135deg, transparent 40%, ${col.border}88 40%)`,borderBottomRightRadius:4}}
                              onMouseDown={e=>onResizeMouseDown(e,c)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* ── Legend ── */}
                <div className="px-4 py-2 bg-cyan-100 border-t border-cyan-200 flex flex-wrap gap-4 text-xs text-cyan-800">
                  <span className="flex items-center gap-1 font-medium"><span className="w-4 h-4 rounded-full bg-white border-2 border-pink-400 inline-flex items-center justify-center text-[8px] font-black text-pink-500">A</span>MC</span>
                  <span className="flex items-center gap-1 font-medium"><span className="inline-flex gap-0.5"><span className="px-1 bg-green-50 border border-green-500 text-green-700 text-[8px] font-black rounded">Đ</span><span className="px-1 bg-red-50 border border-red-500 text-red-700 text-[8px] font-black rounded">S</span></span>Đúng/Sai</span>
                  <span className="flex items-center gap-1 font-medium"><span className="px-1.5 py-0.5 bg-blue-50 border border-blue-400 text-blue-700 text-[8px] font-black rounded">SA</span>Trả lời ngắn — kéo góc ⬘ resize</span>
                  <span className="ml-auto text-cyan-600 font-semibold">{overlayControls.length} controls · {previewPages.length} trang</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Summary ── */}
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-4">
          <p className="font-semibold text-teal-800 mb-2">📋 {config.title}</p>
          <div className="flex flex-wrap gap-3 text-xs">
            {config.mcCount>0&&<span className="bg-teal-100 text-teal-700 px-2 py-1 rounded-full font-semibold">🔘 {config.mcCount} TN</span>}
            {config.tfCount>0&&<span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-semibold">☑️ {config.tfCount} Đ/S</span>}
            {config.saCount>0&&<span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-full font-semibold">✍️ {config.saCount} TLN</span>}
            {config.writingCount>0&&<span className="bg-green-100 text-green-700 px-2 py-1 rounded-full font-semibold">📝 {config.writingCount} TL</span>}
            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-semibold">⏱ {config.timeLimit} phút</span>
            <span className={`px-2 py-1 rounded-full font-semibold ${overlayMode?"bg-cyan-100 text-cyan-700":"bg-gray-100 text-gray-600"}`}>{overlayMode?"🖊️ Overlay":"📋 Panel"}</span>
            <span className={`px-2 py-1 rounded-full font-semibold ${answeredCount<totalAutoQ?"bg-orange-100 text-orange-600":"bg-green-100 text-green-700"}`}>🔑 {answeredCount}/{totalAutoQ}</span>
          </div>
        </div>

        <DriveUploadBlock label="📄 Upload PDF đề thi" pdfBase64={pdfBase64} pdfFileName={pdfFileName} pdfSizeKB={pdfSizeKB} examTitle={config.title} result={driveResult} status={uploadStatus} error={uploadError} onUpload={handleUploadExam} onReset={()=>{setDriveResult(null);setUploadStatus("idle");setUploadError("");}}/>
        {solutionBase64&&<DriveUploadBlock label={`📋 Upload PDF lời giải (${solutionMode==="full"?"Nguyên bản":"Cắt câu"})`} pdfBase64={solutionBase64} pdfFileName={solutionFileName} pdfSizeKB={solutionSizeKB} examTitle={`${config.title}_loigiai`} result={solDriveResult} status={solUploadStatus} error={solUploadError} onUpload={handleUploadSolution} onReset={()=>{setSolDriveResult(null);setSolUploadStatus("idle");setSolUploadError("");}}/>}
        {!solutionBase64&&<div className="mb-4 bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-500">ℹ️ Chưa có PDF lời giải. <button className="underline text-teal-600 hover:text-teal-800" onClick={()=>setStep(2)}>Thêm ở bước 2</button></div>}

        {pointsConfig&&<PointsConfigEditor config={pointsConfig} onChange={setPointsConfig} onClose={()=>{}} closeOnSave={false} isSaving={isSaving}/>}

        <div className="flex justify-between mt-6">
          <button onClick={()=>setStep(4)} className="px-5 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">← Quay lại</button>
          <div className="flex flex-col items-end gap-1.5">
            {overlayMode&&overlayControls.length>0&&(
              <span className="text-xs font-medium text-teal-700 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block"/>
                Sẽ lưu {overlayControls.length} overlay controls
              </span>
            )}
            <button onClick={handleSave} disabled={!canSave} className="px-8 py-2 bg-teal-600 text-white rounded-lg font-semibold disabled:opacity-40 hover:bg-teal-700 flex items-center gap-2 shadow-md">
              {isSaving&&<span className="animate-spin">⏳</span>}
              {isSaving?"Đang lưu...":!driveResult?"☁️ Upload Drive trước":"💾 Lưu đề thi"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export default PDFExamCreator;
