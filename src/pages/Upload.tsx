import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, addDoc, serverTimestamp, orderBy, limit, Timestamp, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../AuthContext';
import { Supplier } from '../types';
import { UploadCloud, FileText, AlertCircle, CheckCircle2, Loader2, Table, ArrowRight, Settings2, RefreshCw, Trash2 } from 'lucide-react';
import { extractQuotationData } from '../services/geminiService';
import { findBestMatch } from '../services/matchingEngine';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { 
  extractColumnCandidates, 
  applyColumnMapping, 
  ColumnMapping 
} from '../utils/uploadColumnMapping';
import { 
  createUploadSession, 
  markUploadFailed,
  markUploadAbandoned,
  deleteUploadSession
} from '../services/uploadSessionService';
import { 
  loadActiveUploadSession, 
  saveLocalUploadDraft, 
  loadLocalUploadDraft, 
  clearLocalUploadDraft, 
  markUploadStep 
} from '../services/uploadResumeService';
import { saveUploadItems } from '../services/uploadItemsService';
import { runUploadMatchingPipeline } from '../services/uploadMatchingPipelineService';
import { COLLECTIONS } from '../services/firestoreCollections';
import { cn, formatSnapshotDate, devLog } from '../lib/utils';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';

const Upload: React.FC = () => {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'mapping' | 'processing'>('upload');
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<string>('Preparing upload...');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    productNameColumn: null,
    priceColumn: null,
    skuColumn: null,
    currencyColumn: null,
    qtyColumn: null,
  });
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [availableCurrencies, setAvailableCurrencies] = useState<{code: string, name?: string}[]>([]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [recentUploads, setRecentUploads] = useState<any[]>([]);
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);
  const [isResuming, setIsResuming] = useState(false);
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const columnCandidates = useMemo(() => extractColumnCandidates(parsedRows), [parsedRows]);

  useEffect(() => {
    if (!profile?.uid) return;

    const uploadsRef = collection(db, COLLECTIONS.SUPPLIER_UPLOADS);
    
    // 1. Listen for active Firestore session (draft, processing, failed)
    const activeQuery = query(
      uploadsRef,
      where('ownerUserId', '==', profile.uid),
      where('status', 'in', ['draft', 'processing', 'failed']),
      limit(1)
    );

    const unsubActive = onSnapshot(activeQuery, (snap) => {
      if (!snap.empty) {
        setActiveSession({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } else {
        setActiveSession(null);
      }
      setHasLoadedInitial(true);
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.SUPPLIER_UPLOADS);
      } catch (e) {
        devLog.error("Error listening to active session:", getFirestoreErrorMessage(e));
      }
      setHasLoadedInitial(true);
    });

    // 2. Listen for Review Queue (ready_for_review, needs_review)
    const queueQuery = query(
      uploadsRef,
      where('ownerUserId', '==', profile.uid),
      where('status', 'in', ['ready_for_review', 'needs_review'])
    );

    const unsubQueue = onSnapshot(queueQuery, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      items.sort((a: any, b: any) => {
        const dateA = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : new Date(a.createdAt as any).getTime();
        const dateB = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : new Date(b.createdAt as any).getTime();
        return dateB - dateA;
      });
      setReviewQueue(items);
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.SUPPLIER_UPLOADS);
      } catch (e) {
        devLog.error("Error listening to review queue:", getFirestoreErrorMessage(e));
      }
    });

    // 3. Listen for recent finalized uploads
    const recentQuery = query(
      uploadsRef,
      where('ownerUserId', '==', profile.uid),
      where('status', '==', 'finalized'),
      limit(10)
    );

    const unsubRecent = onSnapshot(recentQuery, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      docs.sort((a: any, b: any) => {
        const dateA = a.finalizedAt instanceof Timestamp ? a.finalizedAt.toMillis() : new Date(a.finalizedAt as any).getTime();
        const dateB = b.finalizedAt instanceof Timestamp ? b.finalizedAt.toMillis() : new Date(b.finalizedAt as any).getTime();
        return dateB - dateA;
      });
      setRecentUploads(docs.slice(0, 5));
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.SUPPLIER_UPLOADS);
      } catch (e) {
        devLog.error("Error listening to recent uploads:", getFirestoreErrorMessage(e));
      }
    });

    // 4. Check for local draft if no active session (one-time check)
    const checkLocalDraft = () => {
      const draft = loadLocalUploadDraft(profile.uid);
      if (draft) {
        setSelectedSupplier(draft.supplierId);
        setColumnMapping(draft.mapping as any);
        setDefaultCurrency(draft.defaultCurrency || 'USD');
        setFileName(draft.fileName || '');
        if (draft.parsedRows && draft.parsedRows.length > 0) {
          setParsedRows(draft.parsedRows);
          setStep(draft.step as any);
        }
      }
    };
    checkLocalDraft();

    return () => {
      unsubActive();
      unsubQueue();
      unsubRecent();
    };
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile?.uid || step === 'processing' || !hasLoadedInitial) return;
    
    saveLocalUploadDraft(profile.uid, {
      supplierId: selectedSupplier,
      fileName: fileName || file?.name || '',
      parsedRows,
      mapping: columnMapping,
      defaultCurrency,
      step
    });
  }, [selectedSupplier, file, fileName, parsedRows, columnMapping, defaultCurrency, step, profile?.uid]);

  useEffect(() => {
    if (!profile?.uid) return;
    const fetchSuppliers = async () => {
      try {
        const q = query(collection(db, COLLECTIONS.SUPPLIERS), where('ownerUserId', '==', profile.uid));
        const snap = await getDocs(q);
        setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier)));
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, COLLECTIONS.SUPPLIERS);
        } catch (e) {
          devLog.error("Failed to fetch suppliers:", getFirestoreErrorMessage(e));
        }
      }
    };
    fetchSuppliers();
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile?.uid) return;

    const fetchCurrencies = async () => {
      try {
        const q = query(
              collection(db, COLLECTIONS.EXCHANGE_RATES),
              where('ownerUserId', '==', profile.uid)
            );
        const snap = await getDocs(q);
        const currencies = snap.docs.map(d => {
          const data = d.data();
          return {
            code: data.toCurrency,
            name: CURRENCY_NAMES[data.toCurrency] || data.toCurrency
          };
        });
        
        // Ensure USD is always an option if not present
        if (!currencies.find(c => c.code === 'USD')) {
          currencies.push({ code: 'USD', name: 'US Dollar' });
        }
        
        // Sort in memory to avoid composite index requirement
        currencies.sort((a, b) => (a.code || '').localeCompare(b.code || ''));

        setAvailableCurrencies(currencies);

        // If no default currency is set yet, or if it's not in the new list, pick a safe one
        if (currencies.length > 0) {
          const currentExists = currencies.some(c => c.code === defaultCurrency);
          if (!currentExists) {
            setDefaultCurrency(currencies[0].code);
          }
        }
      } catch (err) {
        devLog.error("Failed to fetch currencies:", err);
        // Fallback to basic list if fetch fails
        setAvailableCurrencies([
          { code: 'USD', name: 'US Dollar' },
          { code: 'KWD', name: 'Kuwaiti Dinar' },
          { code: 'EUR', name: 'Euro' },
          { code: 'AED', name: 'UAE Dirham' }
        ]);
      }
    };

    fetchCurrencies();
  }, [profile?.uid]);

  useEffect(() => {
    if (selectedSupplier && suppliers.length > 0 && availableCurrencies.length > 0) {
      const supplier = suppliers.find(s => s.id === selectedSupplier);
      if (supplier?.defaultCurrency) {
        const exists = availableCurrencies.some(c => c.code === supplier.defaultCurrency);
        if (exists) {
          setDefaultCurrency(supplier.defaultCurrency);
        }
      }
    }
  }, [selectedSupplier, suppliers, availableCurrencies]);

  const CURRENCY_NAMES: Record<string, string> = {
    'USD': 'US Dollar',
    'KWD': 'Kuwaiti Dinar',
    'EUR': 'Euro',
    'GBP': 'British Pound',
    'AED': 'UAE Dirham',
    'SAR': 'Saudi Riyal',
    'BHD': 'Bahraini Dinar',
    'OMR': 'Omani Rial',
    'QAR': 'Qatari Riyal',
    'JOD': 'Jordanian Dinar',
    'EGP': 'Egyptian Pound'
  };

  const processFile = (selectedFile: File) => {
    setFile(selectedFile);
    setFileName(selectedFile.name);
    
    // If structured file, parse it for mapping
    const isStructured = selectedFile.name.endsWith('.xlsx') || 
                        selectedFile.name.endsWith('.xls') || 
                        selectedFile.name.endsWith('.csv');
    
    if (isStructured) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataBuffer = evt.target?.result;
        if (!dataBuffer) return;
        
        const wb = XLSX.read(new Uint8Array(dataBuffer as ArrayBuffer), { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        setParsedRows(data);
        
        // Auto-suggest columns
        const candidates = extractColumnCandidates(data as any[]);
        const suggestedMapping = {
          productNameColumn: candidates.find(c => /name|desc|product|item/i.test(c)) || candidates[0] || null,
          priceColumn: candidates.find(c => /price|cost|rate|unit/i.test(c)) || null,
          skuColumn: candidates.find(c => /sku|code|ref|part/i.test(c)) || null,
          currencyColumn: candidates.find(c => /curr|mon/i.test(c)) || null,
          qtyColumn: candidates.find(c => /qty|quant|amount/i.test(c)) || null,
        };
        setColumnMapping(suggestedMapping);

        if (profile?.uid) {
          saveLocalUploadDraft(profile.uid, {
            supplierId: selectedSupplier,
            fileName: selectedFile.name,
            parsedRows: data,
            mapping: suggestedMapping as any,
            step: 'mapping'
          });
        }
      };
      reader.readAsArrayBuffer(selectedFile);
    } else {
      setParsedRows([]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleStartProcessing = () => {
    if (parsedRows.length > 0) {
      setStep('mapping');
    } else {
      handleUpload();
    }
  };

  const handleUpload = async () => {
    devLog.log('>>> handleUpload triggered');
    
    const currentFileName = fileName || file?.name;

    if (!file && parsedRows.length === 0) {
      devLog.error('handleUpload aborted: No file selected for AI extraction');
      setStatus('Please select a file first.');
      return;
    }

    if (!currentFileName) {
      devLog.error('handleUpload aborted: No file name available');
      setStatus('File information missing. Please re-select the file.');
      return;
    }

    if (!selectedSupplier) {
      devLog.error('handleUpload aborted: No supplier selected');
      setStatus('Please select a supplier.');
      return;
    }
    if (!profile) {
      devLog.error('handleUpload aborted: No user profile found');
      setStatus('User profile not loaded. Please refresh the page.');
      return;
    }

    setStep('processing');
    setUploading(true);
    setStatus(null);

    if (profile?.uid) {
      clearLocalUploadDraft(profile.uid);
    }

    try {
      let uploadId = '';

      if (parsedRows.length > 0) {
        devLog.log('>>> Starting Structured Data Upload Flow');
        devLog.log(`>>> Parsed ${parsedRows.length} rows`);
        
        if (!columnMapping.productNameColumn || !columnMapping.priceColumn) {
          devLog.error('handleUpload validation failed: Missing required column mappings', columnMapping);
          throw new Error('Please ensure both Product Name and Price columns are mapped before processing.');
        }

        devLog.log('>>> Creating upload session in Firestore...');
        setCurrentStep("Creating upload session...");
        setProgress(20);
        
        try {
          uploadId = await createUploadSession({
            ownerUserId: profile.uid,
            supplierId: selectedSupplier,
            fileName: currentFileName,
            totalRows: parsedRows.length
          });
          devLog.log('>>> Upload session created successfully:', uploadId);
          await markUploadStep(uploadId, 1);
        } catch (error) {
          devLog.error("createUploadSession failed:", error);
          throw new Error(`Failed to create upload session: ${(error as Error).message}`);
        }

        devLog.log('>>> Applying column mapping to parsed rows...');
        setCurrentStep("Preparing quotation data...");
        setProgress(40);
        await markUploadStep(uploadId, 2);
        const supplier = suppliers.find(s => s.id === selectedSupplier);
        const normalizedItems = applyColumnMapping(
          parsedRows, 
          columnMapping, 
          defaultCurrency, // UI Fallback
          supplier?.defaultCurrency, // Supplier Default
          'USD' // Global Default
        );
        devLog.log(`>>> Normalized ${normalizedItems.length} items`);

        devLog.log('>>> Saving upload items to raw collection...');
        setCurrentStep("Saving items...");
        setProgress(70);
        await markUploadStep(uploadId, 3);
        try {
          await saveUploadItems({
            uploadId,
            ownerUserId: profile.uid,
            supplierId: selectedSupplier,
            items: normalizedItems
          });
          devLog.log('>>> Raw items saved successfully');
        } catch (error) {
          devLog.error("saveUploadItems failed:", error);
          throw new Error(`Failed to save raw items: ${(error as Error).message}`);
        }

        devLog.log('>>> Starting background matching pipeline...');
        setCurrentStep("Starting matching engine...");
        setProgress(90);
        await markUploadStep(uploadId, 4);
        
        // ASYNC: Don't await the full pipeline
        runUploadMatchingPipeline({
          uploadId,
          ownerUserId: profile?.uid || user?.uid || '',
          supplierId: selectedSupplier
        }).then(() => {
          devLog.log('>>> Matching pipeline completed successfully');
        }).catch(err => {
          devLog.error("runUploadMatchingPipeline failed (async):", err);
        });

        setProgress(100);
        setCurrentStep("Processing started. Redirecting to review page...");
        if (profile?.uid) {
          clearLocalUploadDraft(profile.uid);
        }
        navigate(`/app/review/${uploadId}`);
        
      } else {
        devLog.log('>>> Starting AI-powered Extraction Flow (PDF/Image)');
        // AI FLOW (PDF/Images)
        // KEEP FIREBASE STORAGE FLOW
        devLog.log('>>> Uploading file to Firebase Storage...');
        setCurrentStep("Uploading file to storage...");
        setProgress(10);

        const storageRef = ref(storage, `quotations/${profile?.uid || user?.uid}/${Date.now()}_${currentFileName}`);
        const uploadTask = uploadBytesResumable(storageRef, file!);
        
        try {
          await new Promise((resolve, reject) => {
            uploadTask.on('state_changed', 
              (snapshot) => {
                const progressPercent = (snapshot.bytesTransferred / snapshot.totalBytes) * 10;
                setProgress(progressPercent);
              }, 
              (error) => {
                devLog.error("Firebase Storage Upload Error:", error);
                reject(error);
              }, 
              () => resolve(null)
            );
          });
        } catch (storageError) {
          devLog.error("Storage upload failed explicitly:", storageError);
          throw new Error(`Storage upload failed: ${(storageError as Error).message}`);
        }

        const fileUrl = await getDownloadURL(uploadTask.snapshot.ref);

        setCurrentStep("Creating upload session...");
        setProgress(25);
        try {
          uploadId = await createUploadSession({
            ownerUserId: profile?.uid || user?.uid || '',
            supplierId: selectedSupplier,
            fileName: currentFileName,
            totalRows: 0 
          });
          await markUploadStep(uploadId, 1);
        } catch (error) {
          devLog.error("createUploadSession failed:", error);
          throw error;
        }

        setCurrentStep("Preparing quotation data...");
        setProgress(40);
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
          };
        });
        reader.readAsDataURL(file);
        const base64 = await base64Promise;

        // ASYNC: Run extraction and matching in background
        (async () => {
          try {
            devLog.log('>>> AI Pipeline: Starting extraction...');
            await markUploadStep(uploadId, 2);
            const extractedItems = await extractQuotationData(base64, file.type);
            devLog.log(`>>> AI Pipeline: Extracted ${extractedItems.length} items`);
            
            if (extractedItems.length === 0) {
              throw new Error("No items could be extracted from this document. Please ensure it is a valid quotation.");
            }

            // Save items to raw collection
            const supplier = suppliers.find(s => s.id === selectedSupplier);
            const normalizedItems = extractedItems.map(item => ({
              rawName: item.rawName,
              rawCode: item.rawCode || null,
              rawPrice: item.price ?? null,
              // Precedence: 1. Row 2. UI Fallback 3. Supplier Default 4. Global
              rawCurrency: item.currency || defaultCurrency || supplier?.defaultCurrency || 'USD',
              rawRowData: item, // Store the extracted item as raw data
            }));

            devLog.log('>>> AI Pipeline: Saving raw items...');
            await markUploadStep(uploadId, 3);
            try {
              await saveUploadItems({
                uploadId,
                ownerUserId: profile?.uid || user?.uid || '',
                supplierId: selectedSupplier,
                items: normalizedItems
              });
              devLog.log('>>> AI Pipeline: Raw items saved');
            } catch (error) {
              devLog.error("saveUploadItems failed:", error);
              throw error;
            }

            // Run matching
            devLog.log('>>> AI Pipeline: Starting matching pipeline...');
            await markUploadStep(uploadId, 4);
            try {
              await runUploadMatchingPipeline({
                uploadId,
                ownerUserId: profile?.uid || user?.uid || '',
                supplierId: selectedSupplier
              });
              devLog.log('>>> AI Pipeline: Matching pipeline completed');
            } catch (error) {
              devLog.error("runUploadMatchingPipeline failed:", error);
              throw error;
            }
          } catch (err) {
            devLog.error('AI Pipeline failed:', err);
            try {
              await markUploadFailed(uploadId, `AI Pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
            } catch (markErr) {
              devLog.error("Failed to mark upload as failed:", markErr);
            }
          }
        })();

        setProgress(100);
        setCurrentStep("Processing started. Redirecting to review page...");
        if (profile?.uid) {
          clearLocalUploadDraft(profile.uid);
        }
        navigate(`/app/review/${uploadId}`);
      }
    } catch (error) {
      devLog.error("Upload process failed:", error);
      try {
        handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.SUPPLIER_UPLOADS);
      } catch (e) {
        setStatus(getFirestoreErrorMessage(e, "Upload failed. Please check console for details."));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleStartNew = async () => {
    if (activeSession && activeSession.status !== 'finalized') {
      try {
        await markUploadAbandoned(activeSession.id);
      } catch (err) {
        devLog.error("Failed to mark session as abandoned:", err);
      }
    }
    
    // Clear everything
    if (profile?.uid) {
      clearLocalUploadDraft(profile.uid);
    }
    
    setActiveSession(null);
    setFile(null);
    setFileName('');
    setParsedRows([]);
    setStep('upload');
    setStatus(null);
    setSelectedSupplier('');
    setColumnMapping({
      productNameColumn: null,
      skuColumn: null,
      priceColumn: null,
      currencyColumn: null,
      qtyColumn: null
    });
  };

  const handleDeleteQueueItem = async (uploadId: string) => {
    setIsDeleting(true);
    try {
      await deleteUploadSession(uploadId);
      setDeleteConfirmId(null);
    } catch (err) {
      devLog.error("Failed to delete upload session:", err);
      // Even on error, we might want to close the modal if the error is "not found"
      // But for now, let's just alert the user
      alert("Failed to delete. Please check your connection or permissions.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-8 px-4">
      <div className="text-center">
        <h2 className="text-3xl font-bold">Upload Quotation</h2>
        <p className="text-stone-500 mt-2">Upload a PDF, Excel, or CSV to extract and compare prices.</p>
      </div>

      <AnimatePresence mode="wait">
        {reviewQueue.length > 0 && step === 'upload' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 mb-8"
          >
            <div className="flex items-center justify-between px-2">
              <h3 className="text-sm font-bold text-stone-400 uppercase tracking-widest">Review Queue</h3>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold uppercase tracking-wider">
                {reviewQueue.length} Pending
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reviewQueue.map(item => (
                <div key={item.id} className="relative group">
                  <button
                    onClick={() => navigate(`/app/review/${item.id}`)}
                    className="w-full flex items-center justify-between p-4 bg-white border border-stone-200 rounded-2xl hover:border-stone-900 hover:shadow-lg transition-all text-left group/item"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover/item:bg-stone-900 group-hover/item:text-white transition-colors">
                        <RefreshCw className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-bold text-stone-900 line-clamp-1">{item.fileName}</p>
                        <p className="text-xs text-stone-500">
                          {suppliers.find(s => s.id === item.supplierId)?.name || 'Unknown'} • {item.status === 'needs_review' ? 'Needs Review' : 'Ready for Review'}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-stone-300 group-hover/item:text-stone-900 transition-colors" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmId(item.id);
                    }}
                    className="absolute -top-2 -right-2 p-2 bg-white border border-stone-200 text-stone-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 rounded-xl shadow-sm transition-all opacity-0 group-hover:opacity-100 z-10"
                    title="Delete upload"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {activeSession && (
          <motion.div
            key="resume"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white p-8 rounded-3xl border border-stone-200 shadow-xl space-y-6 mb-8"
          >
            <div className="flex items-center gap-4 p-4 bg-amber-50 rounded-2xl border border-amber-100">
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                activeSession.status === 'failed' ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
              )}>
                {activeSession.status === 'failed' ? <AlertCircle className="w-6 h-6" /> : <RefreshCw className="w-6 h-6" />}
              </div>
              <div>
                <h3 className={cn("font-bold", activeSession.status === 'failed' ? "text-red-900" : "text-amber-900")}>
                  {activeSession.status === 'failed' ? "Interrupted Upload Found" : 
                   activeSession.status === 'processing' ? "Upload Still Processing" :
                   "Active Upload Session Found"}
                </h3>
                <p className={cn("text-sm", activeSession.status === 'failed' ? "text-red-700" : "text-amber-700")}>
                  {activeSession.status === 'failed' 
                    ? `An error occurred during upload for ${activeSession.fileName}.`
                    : activeSession.status === 'processing'
                    ? `The matching engine is still working on ${activeSession.fileName}.`
                    : `You have an unfinished upload for ${activeSession.fileName}.`
                  }
                </p>
              </div>
            </div>

            {activeSession.status === 'failed' && activeSession.error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl">
                <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">Error Details</p>
                <p className="text-sm text-red-800">{activeSession.error}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">Supplier</p>
                <p className="text-lg font-bold">{suppliers.find(s => s.id === activeSession.supplierId)?.name || 'Unknown'}</p>
              </div>
              <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">Status</p>
                <p className="text-lg font-bold capitalize">{activeSession.status.replace(/_/g, ' ')}</p>
              </div>
              <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">Progress</p>
                <p className="text-lg font-bold">{activeSession.processedRows} / {activeSession.totalRows} Rows</p>
              </div>
              <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">Started</p>
                <p className="text-lg font-bold">{formatSnapshotDate(activeSession)}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {activeSession.status === 'ready_for_review' || activeSession.status === 'completed' ? (
                <button
                  onClick={() => navigate(`/app/review/${activeSession.id}`)}
                  className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  Resume Review
                  <ArrowRight className="w-5 h-5" />
                </button>
              ) : activeSession.status === 'failed' ? (
                <button
                  onClick={() => navigate(`/app/review/${activeSession.id}`)}
                  className="w-full bg-red-600 text-white font-bold py-4 rounded-2xl hover:bg-red-700 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  View Partial Results
                  <ArrowRight className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={() => navigate(`/app/review/${activeSession.id}`)}
                  className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  Continue Processing
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
              
              <button
                onClick={handleStartNew}
                className="w-full bg-white text-stone-600 font-bold py-4 rounded-2xl border border-stone-200 hover:bg-stone-50 transition-all flex items-center justify-center gap-2"
              >
                Start New Upload
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirmId(activeSession.id);
                }}
                className="w-full bg-white text-red-600 font-bold py-4 rounded-2xl border border-red-100 hover:bg-red-50 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-5 h-5" />
                Delete Session
              </button>
            </div>
          </motion.div>
        )}

        {!activeSession && step === 'upload' && (
          <motion.div 
            key="upload"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white p-8 rounded-3xl border border-stone-200 shadow-xl space-y-6"
          >
            {/* Supplier Selection */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-stone-700 uppercase tracking-wider">Select Supplier</label>
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-stone-900/5 outline-none transition-all"
              >
                <option value="">Choose a supplier...</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* File Dropzone */}
            <div 
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "relative group border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer",
                isDragging ? "border-stone-900 bg-stone-50 scale-[1.01]" : 
                file ? "border-emerald-200 bg-emerald-50/30" : "border-stone-200 hover:border-stone-400 hover:bg-stone-50"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="hidden"
                accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
              />
              <div className="space-y-4">
                <div className={cn(
                  "w-16 h-16 mx-auto rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110",
                  file ? "bg-emerald-100 text-emerald-600" : "bg-stone-100 text-stone-400"
                )}>
                  {file ? <FileText className="w-8 h-8" /> : <UploadCloud className="w-8 h-8" />}
                </div>
                <div>
                  <p className="text-lg font-bold">{fileName || file?.name || "Click or drag file here"}</p>
                  <p className="text-sm text-stone-500">Supports PDF, Excel, CSV, and Images</p>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={handleStartProcessing}
              disabled={(!file && parsedRows.length === 0) || !selectedSupplier || uploading}
              className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-stone-900/10 flex items-center justify-center gap-2"
            >
              {parsedRows.length > 0 ? "Next: Map Columns" : "Analyze Quotation"}
              <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {step === 'mapping' && (
          <motion.div 
            key="mapping"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="bg-white p-8 rounded-3xl border border-stone-200 shadow-xl space-y-8"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-stone-100 rounded-xl flex items-center justify-center text-stone-600">
                  <Settings2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Column Mapping</h3>
                  <p className="text-sm text-stone-500">Tell us which columns contain the product data.</p>
                </div>
              </div>
              <button 
                onClick={() => setStep('upload')}
                className="text-sm font-bold text-stone-500 hover:text-stone-900"
              >
                Back to Upload
              </button>
            </div>

            {/* Mapping Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { label: 'Product Name', key: 'productNameColumn', required: true },
                { label: 'Price', key: 'priceColumn', required: true },
                { label: 'SKU / Code', key: 'skuColumn', required: false },
                { label: 'Currency Column', key: 'currencyColumn', required: false },
                { label: 'Quantity', key: 'qtyColumn', required: false },
              ].map((field) => (
                <div key={field.key} className="space-y-2">
                  <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    value={columnMapping[field.key as keyof ColumnMapping] || ''}
                    onChange={(e) => {
                      const newVal = e.target.value || null;
                      const newMapping = { ...columnMapping, [field.key]: newVal };
                      setColumnMapping(newMapping);
                      if (profile?.uid && file) {
                        saveLocalUploadDraft(profile.uid, {
                          mapping: newMapping as any
                        });
                      }
                    }}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none transition-all"
                  >
                    <option value="">Select column...</option>
                    {columnCandidates.map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
              ))}

              <div className="space-y-2">
                <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                  Default Currency (Fallback)
                </label>
                <select
                  value={defaultCurrency}
                  onChange={(e) => setDefaultCurrency(e.target.value)}
                  className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none transition-all"
                >
                  {availableCurrencies.length > 0 ? (
                    availableCurrencies.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.code} - {c.name || CURRENCY_NAMES[c.code] || c.code}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="USD">USD - US Dollar</option>
                      <option value="KWD">KWD - Kuwaiti Dinar</option>
                      <option value="EUR">EUR - Euro</option>
                      <option value="AED">AED - UAE Dirham</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {/* Preview Table */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-stone-600">
                <Table className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Data Preview (First 5 rows)</span>
              </div>
              <div className="overflow-x-auto border border-stone-100 rounded-2xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-stone-50 border-bottom border-stone-100">
                    <tr>
                      {columnCandidates.map(col => (
                        <th key={col} className="px-4 py-3 font-bold text-stone-700 whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t border-stone-50">
                        {columnCandidates.map(col => (
                          <td key={col} className="px-4 py-3 text-stone-600 whitespace-nowrap">{String(row[col] || '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => {
                  devLog.log('>>> Process button clicked');
                  handleUpload();
                }}
                disabled={!columnMapping.productNameColumn || !columnMapping.priceColumn || uploading}
                className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-stone-900/10 flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Process {parsedRows.length} Items
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              {(!columnMapping.productNameColumn || !columnMapping.priceColumn) && !uploading && (
                <div className="flex items-center justify-center gap-2 text-red-500 bg-red-50 p-3 rounded-xl border border-red-100 animate-pulse">
                  <AlertCircle className="w-4 h-4" />
                  <p className="text-xs font-bold uppercase tracking-wider">
                    Required: Map "Product Name" and "Price" columns
                  </p>
                </div>
              )}

              {status && status.startsWith('Error') && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                  <p className="text-sm text-red-800">{status}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {step === 'processing' && (
          <motion.div 
            key="processing"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-12 rounded-3xl border border-stone-200 shadow-xl text-center space-y-6"
          >
            <div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center mx-auto">
              <Loader2 className="w-10 h-10 text-stone-900 animate-spin" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-bold">Processing Quotation</h3>
              <div className="space-y-2">
                <p className="text-sm text-stone-500">{currentStep}</p>

                <div className="w-full bg-stone-100 h-3 rounded-full overflow-hidden">
                  <div
                    className="bg-stone-900 h-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <p className="text-xs text-stone-400 text-right">
                  {progress}%
                </p>
              </div>

              {progress > 0 && progress < 100 && (
                <div className="pt-4 animate-in fade-in duration-1000 delay-500">
                  <p className="text-xs text-stone-400 leading-relaxed italic">
                    Connection interrupted? Refresh the page to resume this session.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
          <p className="text-xs text-blue-800 leading-relaxed">
            AI will extract prices and suggest matches. You will have a chance to review everything before saving.
          </p>
        </div>
        <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-800 leading-relaxed">
            Approved matches are remembered as aliases to improve future accuracy.
          </p>
        </div>
      </div>

      {deleteConfirmId && (
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full space-y-6"
          >
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 className="w-8 h-8" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold">Delete Quotation?</h3>
              <p className="text-stone-500">This will permanently remove the upload and all its matching results. This action cannot be undone.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                disabled={isDeleting}
                className="flex-1 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-50 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteQueueItem(deleteConfirmId)}
                disabled={isDeleting}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Upload;
