import type { Route } from "./+types/home";
import { useState } from "react";
import {
  Search,
  Play,
  Clock,
  User,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Link } from "react-router";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Biblioteca de Hapkido" },
    { name: "description", content: "Biblioteca de técnicas de Hapkido" },
  ];
}

const HapkidoLibrary = () => {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCards, setExpandedCards] = useState<Record<number, boolean>>(
    {},
  );

  // Sample video data
  const videos = [
    {
      id: 1,
      title: "Grupo de Lanzamientos 1",
      participants: "Master Kim, Instructor Lee",
      duration: "0:45",
      thumbnail: "🤸",
      views: 234,
      tags: ["🔵 Azul", "🤸 Lanzamientos", "📚 Set"],
      movements: [
        "Lanzamiento de Cadera",
        "Lanzamiento de Hombro",
        "Lanzamiento de Brazo",
      ],
    },
    {
      id: 2,
      title: "Defensa con Bastón Corto",
      participants: "Instructor Park",
      duration: "0:38",
      thumbnail: "🥢",
      views: 456,
      tags: ["🔴 Rojo", "🥢 Armas", "🎯 Individual"],
      movements: ["Defensa Personal con Bastón"],
    },
    {
      id: 3,
      title: "Primera Secuencia - Llaves Articulares",
      participants: "Master Kim, Estudiante Ana",
      duration: "0:52",
      thumbnail: "🔗",
      views: 189,
      tags: ["🟢 Verde", "🔒 Llaves", "🔗 Secuencia"],
      movements: [
        "Flujo de Llave de Muñeca",
        "Transición de Llave de Codo",
        "Finalización con Llave de Hombro",
      ],
    },
    {
      id: 4,
      title: "Variaciones de Patada Frontal",
      participants: "Instructor Lee, Estudiante Carlos",
      duration: "0:35",
      thumbnail: "🦵",
      views: 312,
      tags: ["⚪ Blanco", "🟡 Amarillo", "🦵 Patadas", "📚 Set"],
      movements: ["Patada Frontal Básica", "Patada Frontal con Salto"],
    },
    {
      id: 5,
      title: "Escape de Abrazo Trasero",
      participants: "Master Kim, Instructor Park",
      duration: "0:28",
      thumbnail: "🤼",
      views: 278,
      tags: ["🟢 Verde", "🏃 Escapes", "🎯 Individual"],
      movements: ["Escape de Abrazo de Oso por Detrás"],
    },
    {
      id: 6,
      title: "Combo de Golpes Básicos",
      participants: "Instructor Park",
      duration: "0:42",
      thumbnail: "✋",
      views: 401,
      tags: ["⚪ Blanco", "🟡 Amarillo", "✊ Golpes", "📚 Set"],
      movements: [
        "Golpe de Mano Cuchillo",
        "Golpe de Mano Inversa",
        "Golpe con Talón de Palma",
      ],
    },
  ];

  // All available tags with categories
  const allTags = [
    // Belt levels
    { value: "⚪ Blanco", category: "belt" },
    { value: "🟡 Amarillo", category: "belt" },
    { value: "🟢 Verde", category: "belt" },
    { value: "🔵 Azul", category: "belt" },
    { value: "🔴 Rojo", category: "belt" },
    { value: "⚫ Negro", category: "belt" },
    // Technique types
    { value: "✊ Golpes", category: "type" },
    { value: "🦵 Patadas", category: "type" },
    { value: "🔒 Llaves", category: "type" },
    { value: "🤸 Lanzamientos", category: "type" },
    { value: "🏃 Escapes", category: "type" },
    { value: "🥢 Armas", category: "type" },
    // Video types
    { value: "🎯 Individual", category: "videoType" },
    { value: "📚 Set", category: "videoType" },
    { value: "🔗 Secuencia", category: "videoType" },
  ];

  const toggleExpand = (videoId: number) => {
    setExpandedCards((prev) => ({
      ...prev,
      [videoId]: !prev[videoId],
    }));
  };

  const filteredVideos = videos.filter((video) => {
    // Check if video has all selected tags
    const matchesTags =
      selectedTags.length === 0 ||
      selectedTags.every((tag) => video.tags.includes(tag));

    // Check if search term matches title, participants, or movements
    const matchesSearch =
      searchTerm === "" ||
      video.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      video.participants.toLowerCase().includes(searchTerm.toLowerCase()) ||
      video.movements.some((m) =>
        m.toLowerCase().includes(searchTerm.toLowerCase()),
      );

    return matchesTags && matchesSearch;
  });

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="bg-slate-900 border-b border-red-900/30 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-red-500">
                Kukkiwon Dojang
              </h1>
              <p className="text-slate-400 mt-1">
                합기도 • Biblioteca de Técnicas Secretas
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-300 text-sm">
                {filteredVideos.length} videos
              </span>
              <Link
                to="/upload"
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
              >
                Subir Video
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Search Bar */}
        <div className="mb-8">
          <div className="relative">
            <Search
              className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Buscar por título, participantes o movimientos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-red-500"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="mb-12">
          <div className="flex flex-wrap gap-x-3 gap-y-4">
            {allTags.map((tag) => (
              <button
                key={tag.value}
                onClick={() => toggleTag(tag.value)}
                className={`px-3 py-2 rounded-full text-sm font-medium transition ${
                  selectedTags.includes(tag.value)
                    ? "bg-red-600 text-white ring-2 ring-red-400"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {tag.value}
              </button>
            ))}
          </div>

          {/* Clear Filters */}
          {(selectedTags.length > 0 || searchTerm) && (
            <button
              onClick={() => {
                setSelectedTags([]);
                setSearchTerm("");
              }}
              className="mt-4 text-sm text-red-400 hover:text-red-300 transition"
            >
              Limpiar todos los filtros
            </button>
          )}
        </div>

        {/* Video Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVideos.map((video) => {
            const isExpanded = expandedCards[video.id];

            return (
              <div
                key={video.id}
                className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700 hover:border-red-500 transition"
              >
                {/* Thumbnail */}
                <div className="relative bg-gradient-to-br from-slate-700 to-slate-800 aspect-video flex items-center justify-center cursor-pointer group">
                  <span className="text-6xl opacity-50 group-hover:scale-110 transition">
                    {video.thumbnail}
                  </span>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                    <Play
                      className="text-white opacity-0 group-hover:opacity-100 transition"
                      size={48}
                    />
                  </div>
                  <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
                    <Clock size={12} />
                    {video.duration}
                  </div>
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="text-white font-semibold mb-2">
                    {video.title}
                  </h3>

                  <div className="flex items-center gap-1 text-xs text-slate-400 mb-3">
                    <User size={14} />
                    {video.participants}
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {video.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Expandable Movements List */}
                  {video.movements.length > 0 && (
                    <div className="border-t border-slate-700 pt-3">
                      <button
                        onClick={() => toggleExpand(video.id)}
                        className="flex items-center justify-between w-full text-sm text-slate-300 hover:text-white transition"
                      >
                        <span className="font-medium">
                          Movimientos Incluidos ({video.movements.length})
                        </span>
                        {isExpanded ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                      </button>

                      {isExpanded && (
                        <ul className="mt-2 space-y-1">
                          {video.movements.map((movement, idx) => (
                            <li
                              key={idx}
                              className="text-xs text-slate-400 pl-4"
                            >
                              • {movement}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* No Results */}
        {filteredVideos.length === 0 && (
          <div className="text-center py-16">
            <p className="text-slate-400 text-lg">
              No hay videos que coincidan con tus filtros
            </p>
            <button
              onClick={() => {
                setSelectedTags([]);
                setSearchTerm("");
              }}
              className="mt-4 text-red-400 hover:text-red-300 transition"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default HapkidoLibrary;
