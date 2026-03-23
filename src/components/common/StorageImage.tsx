import React, { useEffect, useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase';

interface StorageImageProps {
  path: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  width?: number;
  height?: number;
  fallback?: React.ReactNode;
}

const storageUrlCache = new Map<string, string>();

const StorageImage: React.FC<StorageImageProps> = ({
  path,
  alt,
  className,
  style,
  loading = 'lazy',
  width,
  height,
  fallback = <div className="h-full w-full animate-pulse bg-gray-100" />,
}) => {
  const [url, setUrl] = useState(() => (path ? storageUrlCache.get(path) || '' : ''));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path) {
      setUrl('');
      setFailed(false);
      return;
    }

    const cachedUrl = storageUrlCache.get(path);
    if (cachedUrl) {
      setUrl(cachedUrl);
      setFailed(false);
      return;
    }

    let active = true;
    setUrl('');
    setFailed(false);

    getDownloadURL(ref(storage, path))
      .then((downloadUrl) => {
        if (!active) return;
        storageUrlCache.set(path, downloadUrl);
        setUrl(downloadUrl);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [path]);

  if (!path || failed || !url) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      width={width}
      height={height}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};

export default StorageImage;
