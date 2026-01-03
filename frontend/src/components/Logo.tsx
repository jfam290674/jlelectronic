export default function Logo({className=""}:{className?:string}) {
  return (
    <img
      src="/static/images/logo.png"
      alt="JL Electronic"
      className={`h-10 w-auto ${className}`}
      onError={(e)=>{(e.currentTarget as HTMLImageElement).style.display='none'}}
    />
  );
}
