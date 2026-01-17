import { useState, useEffect, type ChangeEvent, type FormEvent } from "react";
import { Upload, X, Film, ArrowLeft, Loader2 } from "lucide-react";
import { useNavigate, useLoaderData } from "react-router";
import { useRequireAuth } from "@/lib/useAuth";
import { readItems, createItem, uploadFiles } from "@directus/sdk";
import { getDirectusClient, checkServerStatus } from "@/lib/directus";

// Loader to fetch tags and movements for autocomplete
export async function loader() {
  const directus = getDirectusClient();

  try {
    const [tags, movements] = await Promise.all([
      directus.request(
        readItems("hapkido_tags", {
          fields: ["id", "name"],
          sort: ["sort_order"],
        }),
      ),
      directus.request(
        readItems("hapkido_movements", {
          fields: ["id", "name"],
          sort: ["sort_order"],
        }),
      ),
    ]);

    return { tags, movements };
  } catch (error) {
    console.error("Error loading autocomplete data:", error);
    return { tags: [], movements: [] };
  }
}

export default function HapkidoUploadForm() {
  // Check authentication
  useRequireAuth();

  const navigate = useNavigate();
  const { tags: existingTags, movements: existingMovements } =
    useLoaderData<typeof loader>();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    participants: "",
    uploadedBy: "",
    tags: [] as string[],
    movements: [] as string[],
  });
  const [tagInput, setTagInput] = useState("");
  const [movementInput, setMovementInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverOnline, setServerOnline] = useState(true);

  // Check server status on mount
  useEffect(() => {
    checkServerStatus().then(setServerOnline);
  }, []);

  const availableTags = existingTags.map((t) => t.name);
  const availableMovements = existingMovements.map((m) => m.name);

  const handleVideoSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = (e.target.files ?? [])[0];
    if (file) {
      setVideoFile(file);
    }
  };

  const addTag = (tag: string) => {
    if (tag && !formData.tags.includes(tag)) {
      setFormData({ ...formData, tags: [...formData.tags, tag] });
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((tag) => tag !== tagToRemove),
    });
  };

  const addMovement = (movement: string) => {
    if (movement && !formData.movements.includes(movement)) {
      setFormData({
        ...formData,
        movements: [...formData.movements, movement],
      });
      setMovementInput("");
    }
  };

  const removeMovement = (movementToRemove: string) => {
    setFormData({
      ...formData,
      movements: formData.movements.filter((m) => m !== movementToRemove),
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!serverOnline) {
      alert(
        "El servidor está temporalmente fuera de línea. Intenta más tarde.",
      );
      return;
    }

    if (
      !videoFile ||
      !formData.title ||
      !formData.participants ||
      !formData.uploadedBy
    ) {
      return;
    }

    setIsSubmitting(true);

    try {
      const directus = getDirectusClient();

      // Step 1: Upload video file
      const formDataFile = new FormData();
      formDataFile.append("file", videoFile);

      const uploadedFile = await directus.request(uploadFiles(formDataFile));
      const videoFileId = uploadedFile.id;

      // Step 2: Get or create tags
      const tagIds = await Promise.all(
        formData.tags.map(async (tagName) => {
          // Check if tag exists
          const existing = existingTags.find((t) => t.name === tagName);
          if (existing) return existing.id;

          // Create new tag
          const newTag = await directus.request(
            createItem("hapkido_tags", {
              name: tagName,
              sort_order: 999, // New tags go to end
            }),
          );
          return newTag.id;
        }),
      );

      // Step 3: Get or create movements
      const movementIds = await Promise.all(
        formData.movements.map(async (movementName) => {
          // Check if movement exists
          const existing = existingMovements.find(
            (m) => m.name === movementName,
          );
          if (existing) return existing.id;

          // Create new movement
          const newMovement = await directus.request(
            createItem("hapkido_movements", {
              name: movementName,
              sort_order: 999,
            }),
          );
          return newMovement.id;
        }),
      );

      // Step 4: Create video item with relations
      const videoData = {
        title: formData.title,
        participants: formData.participants,
        uploaded_by: formData.uploadedBy,
        video_file: videoFileId,
        status: "draft", // Default to draft
        tags: tagIds.map((id) => ({
          hapkido_tags_id: id,
        })),
        movements: movementIds.map((id) => ({
          hapkido_movements_id: id,
        })),
      };

      await directus.request(createItem("hapkido_videos", videoData));

      alert("¡Video subido exitosamente!");
      navigate("/");
    } catch (error) {
      console.error("Upload error:", error);
      alert("Error al subir el video. Por favor intenta de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    videoFile &&
    formData.title &&
    formData.participants &&
    formData.uploadedBy &&
    !isSubmitting;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => history.back()}
            className="mb-3 flex items-center gap-2 p-1 pr-2 rounded-md hover:bg-white/10"
          >
            <ArrowLeft />
            <p>Volver</p>
          </button>
          <h1 className="text-3xl font-bold text-red-500 mb-2">
            Subir Nuevo Video
          </h1>
          <p className="text-slate-400">
            Agregar un nuevo video de técnicas a la biblioteca
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-slate-800 rounded-lg p-8 border border-slate-700 space-y-6"
        >
          {/* Video Upload */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Archivo de Video <span className="text-red-500">*</span>
            </label>
            {!videoFile ? (
              <label className="border-2 border-dashed border-slate-600 rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:border-red-500 transition">
                <Upload className="text-slate-400 mb-2" size={32} />
                <span className="text-slate-400 text-sm">
                  Haz clic para subir video
                </span>
                <span className="text-slate-500 text-xs mt-1">
                  MP4, MOV (máx 100MB)
                </span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoSelect}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="bg-slate-700 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Film className="text-red-500" size={24} />
                  <div>
                    <p className="text-white text-sm font-medium">
                      {videoFile.name}
                    </p>
                    <p className="text-slate-400 text-xs">
                      {(videoFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setVideoFile(null)}
                  className="text-slate-400 hover:text-red-500 transition"
                >
                  <X size={20} />
                </button>
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Título del Video <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              placeholder="ej., Grupo de Técnicas de Lanzamiento 1"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
              required
            />
          </div>

          {/* Participants */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Participantes <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.participants}
              onChange={(e) =>
                setFormData({ ...formData, participants: e.target.value })
              }
              placeholder="ej., Master Kim, Instructor Park, Estudiante Ana"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
              required
            />
            <p className="text-slate-500 text-xs mt-1">
              Separa los nombres con comas
            </p>
          </div>

          {/* Uploaded By */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Tu Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.uploadedBy}
              onChange={(e) =>
                setFormData({ ...formData, uploadedBy: e.target.value })
              }
              placeholder="ej., Juan Pérez"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
              required
            />
            <p className="text-slate-500 text-xs mt-1">
              Para mostrar quién subió este video
            </p>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Etiquetas{" "}
              <span className="text-slate-500 text-xs">(opcional)</span>
            </label>

            {/* Selected Tags */}
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {formData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1.5 rounded-full text-sm bg-red-600 text-white flex items-center gap-2"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="hover:text-red-200"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Tag Input with Autocomplete */}
            <div className="relative">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="Escribe o selecciona etiquetas..."
                list="predefined-tags"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
              />
              <datalist id="predefined-tags">
                {availableTags
                  .filter((tag) => !formData.tags.includes(tag))
                  .map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
              </datalist>
            </div>

            {/* Quick Tag Selection */}
            <div className="mt-3">
              <p className="text-xs text-slate-400 mb-2">
                Etiquetas sugeridas:
              </p>
              <div className="flex flex-wrap gap-2">
                {availableTags
                  .filter((tag) => !formData.tags.includes(tag))
                  .slice(0, 15)
                  .map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addTag(tag)}
                      className="px-2 py-1 rounded text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 transition"
                    >
                      {tag}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Movements */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Movimientos Incluidos{" "}
              <span className="text-slate-500 text-xs">(opcional)</span>
            </label>

            {/* Selected Movements */}
            {formData.movements.length > 0 && (
              <ul className="mb-3 space-y-1">
                {formData.movements.map((movement, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between bg-slate-700 rounded px-3 py-2 text-sm text-slate-200"
                  >
                    <span>• {movement}</span>
                    <button
                      type="button"
                      onClick={() => removeMovement(movement)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Movement Input with Autocomplete */}
            <div className="relative">
              <input
                type="text"
                value={movementInput}
                onChange={(e) => setMovementInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addMovement(movementInput);
                  }
                }}
                placeholder="Escribe un movimiento y presiona Enter..."
                list="common-movements"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
              />
              <datalist id="common-movements">
                {availableMovements.map((movement) => (
                  <option key={movement} value={movement} />
                ))}
              </datalist>
            </div>
            <p className="text-slate-500 text-xs mt-1">
              Presiona Enter para agregar cada movimiento
            </p>
          </div>

          {/* Server Status Warning */}
          {!serverOnline && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-sm text-red-300">
              ⚠️ El servidor está temporalmente fuera de línea. No podrás subir
              videos en este momento.
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!canSubmit || !serverOnline}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Subiendo...
              </>
            ) : (
              "Subir Video"
            )}
          </button>

          {!canSubmit && !isSubmitting && (
            <p className="text-slate-500 text-xs text-center">
              Por favor completa todos los campos requeridos (*)
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
