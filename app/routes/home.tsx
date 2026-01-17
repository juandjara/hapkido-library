import type { Route } from "./+types/home";
import { useState } from "react";
import {
  Search,
  Play,
  User,
  ChevronDown,
  ChevronUp,
  LogOut,
} from "lucide-react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { useRequireAuth } from "@/lib/useAuth";
import { readItems } from "@directus/sdk";
import { serverDirectus, logout } from "@/lib/directus";
import { DIRECTUS_URL } from "@/lib/env";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Biblioteca de Hapkido" },
    { name: "description", content: "Biblioteca de técnicas de Hapkido" },
  ];
}

// Loader runs at build time for SSG (uses server-side static token)
export async function loader() {
  try {
    // Fetch videos with relations (using server client with static token)
    const videos = await serverDirectus.request(
      readItems("hapkido_videos", {
        fields: [
          "id",
          "title",
          "participants",
          "uploaded_by",
          "video_file",
          "tags.hapkido_tags_id.name",
          "movements.hapkido_movements_id.name",
        ],
        sort: ["-date_created"],
      }),
    );

    // Fetch all tags for filters
    const tags = await serverDirectus.request(
      readItems("hapkido_tags", {
        fields: ["id", "name"],
        sort: ["sort_order"],
      }),
    );

    return {
      videos,
      tags,
      directusUrl: DIRECTUS_URL,
    };
  } catch (error) {
    console.error("Error loading data:", error);
    return {
      videos: [],
      tags: [],
      directusUrl: DIRECTUS_URL,
    };
  }
}

// Format duration from seconds to MM:SS
function formatDuration(seconds: number): string {
  if (!seconds) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const HapkidoLibrary = () => {
  // Check authentication (client-side)
  useRequireAuth();

  const navigate = useNavigate();
  const {
    videos: rawVideos,
    tags: allTags,
    directusUrl,
  } = useLoaderData<typeof loader>();

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>(
    {},
  );

  const handleLogout = async () => {
    await logout();
    navigate("/access");
  };

  // Transform Directus data to component format
  const videos = rawVideos.map((video) => ({
    id: video.id,
    title: video.title,
    participants: video.participants,
    uploadedBy: video.uploaded_by,
    videoFile: video.video_file,
    tags: video.tags?.map((t) => t.hapkido_tags_id?.name).filter(Boolean) || [],
    movements:
      video.movements
        ?.map((m) => m.hapkido_movements_id?.name)
        .filter(Boolean) || [],
  }));

  const toggleExpand = (videoId: string) => {
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

  // Get emoji from tag name (first character if it's an emoji)
  const getThumbnail = (tags: string[]) => {
    if (tags.length === 0) return "🥋";
    const firstTag = tags[0];
    const emoji = firstTag.charAt(0);
    return emoji;
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
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
                title="Cerrar sesión"
              >
                <LogOut size={18} />
              </button>
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
                key={tag.id}
                onClick={() => toggleTag(tag.name)}
                className={`px-3 py-2 rounded-full text-sm font-medium transition ${
                  selectedTags.includes(tag.name)
                    ? "bg-red-600 text-white ring-2 ring-red-400"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {tag.name}
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
                {/* Thumbnail/Video Preview */}
                <div className="relative bg-gradient-to-br from-slate-700 to-slate-800 aspect-video flex items-center justify-center cursor-pointer group">
                  {video.videoFile ? (
                    <video
                      src={`${directusUrl}/assets/${video.videoFile}`}
                      className="w-full h-full object-cover"
                      preload="metadata"
                      onError={(e) => {
                        // Fallback to emoji on error
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="text-6xl opacity-50 group-hover:scale-110 transition">
                      {getThumbnail(video.tags)}
                    </span>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                    <Play
                      className="text-white opacity-0 group-hover:opacity-100 transition"
                      size={48}
                    />
                  </div>
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="text-white font-semibold mb-2">
                    {video.title}
                  </h3>

                  <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                    <User size={14} />
                    {video.participants}
                  </div>

                  {video.uploadedBy && (
                    <div className="text-xs text-slate-500 mb-3">
                      Subido por: {video.uploadedBy}
                    </div>
                  )}

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {video.tags.map((tag, idx) => (
                      <span
                        key={`${video.id}-tag-${idx}`}
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
                            <li key={idx} className="text-xs text-slate-400">
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
        {filteredVideos.length === 0 && videos.length === 0 && (
          <div className="text-center py-6">
            <p className="text-slate-400 text-lg">
              No hay ningun video disponible
            </p>
            <Link
              to="/upload"
              className="block mt-4 text-red-400 hover:text-red-300 transition"
            >
              Subir video
            </Link>
          </div>
        )}
        {filteredVideos.length === 0 && videos.length > 0 && (
          <div className="text-center py-6">
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
