import { useState } from 'react';
import { Tv } from 'lucide-react';

interface Props {
  src: string | null;
  alt: string;
  className?: string;
  aspectRatio?: string;
}

export function Poster({ src, alt, className = '', aspectRatio = '2/3' }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div
      className={`relative overflow-hidden bg-surface-700 rounded-lg ${className}`}
      style={{ aspectRatio }}
    >
      {src && !error ? (
        <>
          {!loaded && <div className="absolute inset-0 poster-shimmer" />}
          <img
            src={src}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Tv className="text-surface-400" size={32} />
        </div>
      )}
    </div>
  );
}
