const MoodSongs = ({ Songs }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Songs.map((song, index) => (
        <div 
          key={index} 
          className="bg-[#181818] p-4 rounded-md hover:bg-[#282828] transition-colors duration-300 cursor-pointer group flex flex-col"
        >
          {/* Square Album Art Placeholder */}
          <div className="w-full aspect-square bg-neutral-800 rounded mb-4 shadow-lg relative">
             {/* If you have images later: <img src={song.cover} className="w-full h-full object-cover rounded" /> */}
             
             {/* Green Play Button that appears on hover (Classic Spotify UI) */}
             <div className="absolute bottom-2 right-2 w-12 h-12 bg-green-500 rounded-full shadow-xl flex items-center justify-center text-black opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 hover:scale-105 hover:bg-green-400">
               <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 ml-1">
                 <path d="M8 5v14l11-7z" />
               </svg>
             </div>
          </div>
          
          {/* Song Information */}
          <h3 className="text-white font-bold truncate text-sm mb-1">
            {song.title || `Track ${index + 1}`}
          </h3>
          <p className="text-neutral-400 text-xs truncate font-semibold">
            {song.artist || "Unknown Artist"}
          </p>
        </div>
      ))}
    </div>
  );
};

export default MoodSongs;